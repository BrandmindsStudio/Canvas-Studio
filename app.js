const canvas = document.querySelector("#paintCanvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });
const toolButtons = [...document.querySelectorAll("[data-tool]")];
const colorPicker = document.querySelector("#colorPicker");
const brushSize = document.querySelector("#brushSize");
const brushSizeValue = document.querySelector("#brushSizeValue");
const shapeFill = document.querySelector("#shapeFill");
const snapAngle = document.querySelector("#snapAngle");
const swatches = document.querySelector("#swatches");
const undoBtn = document.querySelector("#undoBtn");
const redoBtn = document.querySelector("#redoBtn");
const clearBtn = document.querySelector("#clearBtn");
const downloadBtn = document.querySelector("#downloadBtn");
const statusTool = document.querySelector("#statusTool");
const statusPosition = document.querySelector("#statusPosition");
const historyStatus = document.querySelector("#historyStatus");
const cursorPreview = document.querySelector("#cursorPreview");

const palette = [
  "#000000", "#ffffff", "#ef4444", "#f59e0b", "#facc15", "#22c55e",
  "#14b8a6", "#38bdf8", "#1f7ae0", "#6366f1", "#a855f7", "#ec4899",
  "#7c2d12", "#64748b", "#94a3b8", "#f8fafc", "#1f2937", "#fb7185"
];

const toolLabels = {
  brush: "Brush",
  eraser: "Eraser",
  line: "Line",
  rect: "Rectangle",
  ellipse: "Ellipse",
  text: "Text",
  fill: "Fill",
  picker: "Picker"
};

let activeTool = "brush";
let isDrawing = false;
let startPoint = null;
let lastPoint = null;
let lastPointerEvent = null;
let previewImage = null;
let undoStack = [];
let redoStack = [];

function initCanvas() {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  pushHistory();
  updateHistoryButtons();
}

function getPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: Math.round((event.clientX - rect.left) * (canvas.width / rect.width)),
    y: Math.round((event.clientY - rect.top) * (canvas.height / rect.height))
  };
}

function setTool(tool) {
  activeTool = tool;
  toolButtons.forEach((button) => button.classList.toggle("active", button.dataset.tool === tool));
  statusTool.textContent = toolLabels[tool];
  updateCursorPreview(lastPointerEvent);
}

function setStrokeStyle() {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = Number(brushSize.value);
  ctx.strokeStyle = activeTool === "eraser" ? "#ffffff" : colorPicker.value;
  ctx.fillStyle = colorPicker.value;
}

function drawLine(from, to) {
  setStrokeStyle();
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();

  if (from.x === to.x && from.y === to.y) {
    ctx.beginPath();
    ctx.arc(from.x, from.y, Number(brushSize.value) / 2, 0, Math.PI * 2);
    ctx.fillStyle = activeTool === "eraser" ? "#ffffff" : colorPicker.value;
    ctx.fill();
  }
}

function normalizedRect(from, to) {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y)
  };
}

function snapPoint(from, to) {
  if (!snapAngle.checked || activeTool !== "line") return to;

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const angle = Math.atan2(dy, dx);
  const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
  const length = Math.hypot(dx, dy);

  return {
    x: Math.round(from.x + Math.cos(snapped) * length),
    y: Math.round(from.y + Math.sin(snapped) * length)
  };
}

function drawShape(from, rawTo) {
  const to = snapPoint(from, rawTo);
  setStrokeStyle();
  ctx.putImageData(previewImage, 0, 0);

  if (activeTool === "line") {
    drawLine(from, to);
    return;
  }

  const rect = normalizedRect(from, to);
  ctx.beginPath();

  if (activeTool === "rect") {
    ctx.rect(rect.x, rect.y, rect.width, rect.height);
  }

  if (activeTool === "ellipse") {
    ctx.ellipse(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
      rect.width / 2,
      rect.height / 2,
      0,
      0,
      Math.PI * 2
    );
  }

  if (shapeFill.checked) ctx.fill();
  ctx.stroke();
}

function colorAt(point) {
  const data = ctx.getImageData(point.x, point.y, 1, 1).data;
  return [data[0], data[1], data[2], data[3]];
}

function hexToRgba(hex) {
  const value = hex.replace("#", "");
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
    255
  ];
}

function colorsMatch(data, index, target) {
  return (
    data[index] === target[0] &&
    data[index + 1] === target[1] &&
    data[index + 2] === target[2] &&
    data[index + 3] === target[3]
  );
}

function setPixel(data, index, color) {
  data[index] = color[0];
  data[index + 1] = color[1];
  data[index + 2] = color[2];
  data[index + 3] = color[3];
}

function floodFill(point) {
  const target = colorAt(point);
  const fill = hexToRgba(colorPicker.value);

  if (target.every((channel, index) => channel === fill[index])) return false;

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data, width, height } = image;
  const stack = [[point.x, point.y]];

  while (stack.length) {
    const [x, y] = stack.pop();
    if (x < 0 || x >= width || y < 0 || y >= height) continue;

    const index = (y * width + x) * 4;
    if (!colorsMatch(data, index, target)) continue;

    setPixel(data, index, fill);
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }

  ctx.putImageData(image, 0, 0);
  return true;
}

function pickColor(point) {
  const [r, g, b] = colorAt(point);
  colorPicker.value = `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
  updateSwatches();
}

function drawText(point) {
  const text = window.prompt("Text");
  if (!text) return;

  const fontSize = Math.max(16, Number(brushSize.value) * 4);
  ctx.fillStyle = colorPicker.value;
  ctx.textBaseline = "top";
  ctx.font = `${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  ctx.fillText(text, point.x, point.y);
  pushHistory();
}

function imageDataEquals(left, right) {
  if (!left || !right || left.data.length !== right.data.length) return false;

  for (let index = 0; index < left.data.length; index += 1) {
    if (left.data[index] !== right.data[index]) return false;
  }

  return true;
}

function pushHistory() {
  const snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const current = undoStack[undoStack.length - 1];

  if (imageDataEquals(current, snapshot)) {
    updateHistoryButtons();
    return false;
  }

  undoStack.push(snapshot);
  if (undoStack.length > 30) undoStack.shift();
  redoStack = [];
  updateHistoryButtons();
  return true;
}

function restore(imageData) {
  ctx.putImageData(imageData, 0, 0);
  canvas.classList.remove("history-flash");
  void canvas.offsetWidth;
  canvas.classList.add("history-flash");
  updateHistoryButtons();
}

function updateHistoryButtons() {
  const undoCount = Math.max(undoStack.length - 1, 0);
  const redoCount = redoStack.length;

  undoBtn.disabled = undoCount === 0;
  redoBtn.disabled = redoCount === 0;
  undoBtn.title = undoCount ? `Undo (${undoCount} available)` : "Undo";
  redoBtn.title = redoCount ? `Redo (${redoCount} available)` : "Redo";
  historyStatus.textContent = `Undo ${undoCount} · Redo ${redoCount}`;
}

function updateSwatches() {
  document.querySelectorAll(".swatch").forEach((button) => {
    button.classList.toggle("active", button.dataset.color.toLowerCase() === colorPicker.value.toLowerCase());
  });
}

function beginDrawing(event) {
  const point = getPoint(event);
  updateCursorPreview(event);

  if (activeTool === "picker") {
    pickColor(point);
    return;
  }

  if (activeTool === "fill") {
    if (floodFill(point)) pushHistory();
    return;
  }

  if (activeTool === "text") {
    drawText(point);
    return;
  }

  isDrawing = true;
  startPoint = point;
  lastPoint = point;
  previewImage = ctx.getImageData(0, 0, canvas.width, canvas.height);

  if (["brush", "eraser"].includes(activeTool)) {
    drawLine(point, point);
  }

  canvas.setPointerCapture(event.pointerId);
}

function continueDrawing(event) {
  const point = getPoint(event);
  statusPosition.textContent = `${point.x}, ${point.y}`;
  updateCursorPreview(event);

  if (!isDrawing) return;

  if (["brush", "eraser"].includes(activeTool)) {
    drawLine(lastPoint, point);
    lastPoint = point;
  }

  if (["line", "rect", "ellipse"].includes(activeTool)) {
    drawShape(startPoint, point);
  }
}

function endDrawing(event) {
  if (!isDrawing) return;
  continueDrawing(event);
  isDrawing = false;
  previewImage = null;
  pushHistory();
}

function cancelDrawing() {
  if (!isDrawing) return;
  if (previewImage) ctx.putImageData(previewImage, 0, 0);
  isDrawing = false;
  previewImage = null;
}

function rgbaFromHex(hex, alpha) {
  const [r, g, b] = hexToRgba(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function updateCursorPreview(event) {
  if (!event || !cursorPreview) return;

  const canvasRect = canvas.getBoundingClientRect();
  const withinCanvas =
    event.clientX >= canvasRect.left &&
    event.clientX <= canvasRect.right &&
    event.clientY >= canvasRect.top &&
    event.clientY <= canvasRect.bottom;

  if (!withinCanvas) {
    cursorPreview.classList.remove("visible");
    return;
  }

  lastPointerEvent = event;
  const stageRect = canvas.parentElement.getBoundingClientRect();
  const canvasScale = canvasRect.width / canvas.width;
  const brushPreviewSize = Math.max(7, Number(brushSize.value) * canvasScale);
  const utilityPreviewSize = 24;
  const isBrushLike = activeTool === "brush" || activeTool === "eraser";
  const size = isBrushLike ? brushPreviewSize : utilityPreviewSize;
  const color = activeTool === "eraser" ? "#ffffff" : colorPicker.value;
  const border = activeTool === "eraser" ? "rgba(29, 29, 31, 0.45)" : color;

  cursorPreview.style.left = `${event.clientX - stageRect.left}px`;
  cursorPreview.style.top = `${event.clientY - stageRect.top}px`;
  cursorPreview.style.setProperty("--cursor-size", `${size}px`);
  cursorPreview.style.setProperty("--cursor-color", border);
  cursorPreview.style.setProperty("--cursor-fill", activeTool === "eraser" ? "rgba(255, 255, 255, 0.72)" : rgbaFromHex(color, 0.16));
  cursorPreview.dataset.mode = activeTool;
  cursorPreview.classList.add("visible");
}

palette.forEach((color) => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "swatch";
  button.dataset.color = color;
  button.style.setProperty("--swatch", color);
  button.title = color;
  button.setAttribute("aria-label", color);
  button.addEventListener("click", () => {
    colorPicker.value = color;
    updateSwatches();
  });
  swatches.append(button);
});

toolButtons.forEach((button) => {
  button.addEventListener("click", () => setTool(button.dataset.tool));
});

brushSize.addEventListener("input", () => {
  brushSizeValue.textContent = brushSize.value;
  updateCursorPreview(lastPointerEvent);
});

colorPicker.addEventListener("input", () => {
  updateSwatches();
  updateCursorPreview(lastPointerEvent);
});

undoBtn.addEventListener("click", () => {
  if (undoStack.length <= 1) return;
  redoStack.push(undoStack.pop());
  restore(undoStack[undoStack.length - 1]);
});

redoBtn.addEventListener("click", () => {
  if (!redoStack.length) return;
  const next = redoStack.pop();
  undoStack.push(next);
  restore(next);
});

clearBtn.addEventListener("click", () => {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  pushHistory();
});

downloadBtn.addEventListener("click", () => {
  const link = document.createElement("a");
  link.download = "mini-paint.png";
  link.href = canvas.toDataURL("image/png");
  link.click();
});

canvas.addEventListener("pointerdown", beginDrawing);
canvas.addEventListener("pointermove", continueDrawing);
canvas.addEventListener("pointerup", endDrawing);
canvas.addEventListener("pointercancel", endDrawing);
canvas.addEventListener("pointerenter", updateCursorPreview);
canvas.addEventListener("pointerleave", (event) => {
  const point = getPoint(event);
  statusPosition.textContent = `${point.x}, ${point.y}`;
  if (!isDrawing) cursorPreview.classList.remove("visible");
});

window.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();

  if (event.key === "Escape") {
    cancelDrawing();
    return;
  }

  if ((event.metaKey || event.ctrlKey) && key === "z" && !event.shiftKey) {
    event.preventDefault();
    undoBtn.click();
  }

  if ((event.metaKey || event.ctrlKey) && (key === "y" || (key === "z" && event.shiftKey))) {
    event.preventDefault();
    redoBtn.click();
  }
});

initCanvas();
updateSwatches();
