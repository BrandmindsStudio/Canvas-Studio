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
const paintControls = document.querySelector("#paintControls");
const aiControls = document.querySelector("#aiControls");
const canvasArea = document.querySelector(".canvas-area");
const ai3dDock = document.querySelector("#ai3dDock");
const aiPrompt = document.querySelector("#aiPrompt");
const aiRunner = document.querySelector("#aiRunner");
const aiRunnerNote = document.querySelector("#aiRunnerNote");
const aiDepth = document.querySelector("#aiDepth");
const aiDepthValue = document.querySelector("#aiDepthValue");
const aiSmooth = document.querySelector("#aiSmooth");
const aiSmoothValue = document.querySelector("#aiSmoothValue");
const generate3dBtn = document.querySelector("#generate3dBtn");
const exportCanvas3dBtn = document.querySelector("#exportCanvas3dBtn");
const ai3dPreview = document.querySelector("#ai3dPreview");
const ai3dStatus = document.querySelector("#ai3dStatus");
const ai3dStats = document.querySelector("#ai3dStats");
const downloadObjLink = document.querySelector("#downloadObjLink");
const download3dFormat = document.querySelector("#download3dFormat");
const reset3dViewBtn = document.querySelector("#reset3dViewBtn");

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
  picker: "Picker",
  ai3d: "AI 3D"
};

let activeTool = "brush";
let isDrawing = false;
let startPoint = null;
let lastPoint = null;
let lastPointerEvent = null;
let previewImage = null;
let undoStack = [];
let redoStack = [];
let ai3dJobTimer = null;
let ai3dCapabilities = null;

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
  const isAi3d = tool === "ai3d";

  paintControls.classList.toggle("hidden", isAi3d);
  aiControls.classList.toggle("hidden", !isAi3d);
  ai3dDock.classList.toggle("hidden", !isAi3d);
  canvasArea.classList.toggle("ai-mode", isAi3d);

  if (isAi3d) {
    cursorPreview.classList.remove("visible");
    resize3dPreview();
    refreshAi3dCapabilities();
  }

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

  if (activeTool === "ai3d") return;

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

  if (activeTool === "ai3d") {
    cursorPreview.classList.remove("visible");
    return;
  }

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

function setAi3dStatus(text, busy = false) {
  ai3dStatus.textContent = text;
  generate3dBtn.disabled = busy;
}

function setDownloadLink(url, format = "OBJ") {
  if (!url) {
    downloadObjLink.href = "#";
    downloadObjLink.classList.add("disabled");
    downloadObjLink.setAttribute("aria-disabled", "true");
    download3dFormat.textContent = format;
    return;
  }

  downloadObjLink.href = url;
  downloadObjLink.download = `canvas-studio.${format.toLowerCase()}`;
  download3dFormat.textContent = format;
  downloadObjLink.classList.remove("disabled");
  downloadObjLink.setAttribute("aria-disabled", "false");
}

async function refreshAi3dCapabilities() {
  try {
    const response = await fetch("/api/ai3d/status");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    ai3dCapabilities = await response.json();
    updateRunnerNote();
  } catch (error) {
    aiRunnerNote.textContent = "Local AI server is not reachable.";
  }
}

function updateRunnerNote() {
  if (!ai3dCapabilities) return;

  if (aiRunner.value === "relief") {
    aiRunnerNote.textContent = "Fast local preview only. Not Meshy-quality.";
    generate3dBtn.disabled = false;
    return;
  }

  const sf3d = ai3dCapabilities.runners?.sf3d;

  aiRunnerNote.textContent = sf3d?.message || "Stable Fast 3D is not installed yet.";
  generate3dBtn.disabled = !sf3d?.available;
}

function sampleCanvasFor3d() {
  const sampleWidth = 72;
  const sampleHeight = Math.round(sampleWidth * (canvas.height / canvas.width));
  const sampleCanvas = document.createElement("canvas");
  const sampleCtx = sampleCanvas.getContext("2d", { willReadFrequently: true });

  sampleCanvas.width = sampleWidth;
  sampleCanvas.height = sampleHeight;
  sampleCtx.fillStyle = "#ffffff";
  sampleCtx.fillRect(0, 0, sampleWidth, sampleHeight);
  sampleCtx.drawImage(canvas, 0, 0, sampleWidth, sampleHeight);

  const pixels = sampleCtx.getImageData(0, 0, sampleWidth, sampleHeight).data;
  const samples = [];
  let maxInk = 0;

  for (let index = 0; index < pixels.length; index += 4) {
    const r = pixels[index];
    const g = pixels[index + 1];
    const b = pixels[index + 2];
    const distanceFromWhite = Math.hypot(255 - r, 255 - g, 255 - b) / 441.7;
    const ink = Math.min(1, Math.max(0, distanceFromWhite));
    maxInk = Math.max(maxInk, ink);
    samples.push({
      i: Number(ink.toFixed(4)),
      r,
      g,
      b
    });
  }

  return {
    width: sampleWidth,
    height: sampleHeight,
    maxInk: Number(maxInk.toFixed(4)),
    samples
  };
}

async function createAi3dJob() {
  if (!ai3dCapabilities) await refreshAi3dCapabilities();

  const selectedRunner = aiRunner.value;
  const sf3d = ai3dCapabilities?.runners?.sf3d;

  if (selectedRunner === "sf3d" && !sf3d?.available) {
    setAi3dStatus(sf3d?.authReady ? "Install needed" : "Needs access");
    ai3dStats.textContent = sf3d?.message || "Stable Fast 3D is not ready";
    updateRunnerNote();
    return;
  }

  setAi3dStatus("Queued", true);
  setDownloadLink(null);
  ai3dStats.textContent = "Preparing mesh";

  const payload = {
    prompt: aiPrompt.value.trim(),
    runner: selectedRunner,
    depth: Number(aiDepth.value),
    smooth: Number(aiSmooth.value),
    canvasPng: canvas.toDataURL("image/png"),
    source: sampleCanvasFor3d()
  };

  try {
    const response = await fetch("/api/ai3d/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const job = await response.json();
    pollAi3dJob(job.id);
  } catch (error) {
    setAi3dStatus("Server offline");
    ai3dStats.textContent = "Start the local AI server";
    generate3dBtn.disabled = false;
  }
}

async function pollAi3dJob(jobId) {
  window.clearTimeout(ai3dJobTimer);

  try {
    const response = await fetch(`/api/ai3d/jobs/${jobId}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const job = await response.json();
    setAi3dStatus(job.status === "done" ? "Done" : "Generating", job.status !== "done" && job.status !== "failed");

    if (job.status === "done") {
      applyAi3dJob(job);
      return;
    }

    if (job.status === "failed") {
      ai3dStats.textContent = job.error || "Generation failed";
      generate3dBtn.disabled = false;
      return;
    }

    ai3dStats.textContent = `${job.progress || 0}%`;
    ai3dJobTimer = window.setTimeout(() => pollAi3dJob(jobId), 650);
  } catch (error) {
    setAi3dStatus("Server offline");
    ai3dStats.textContent = "Connection lost";
    generate3dBtn.disabled = false;
  }
}

function applyAi3dJob(job) {
  generate3dBtn.disabled = false;
  const output = job.output || {};

  if (output.glbUrl) {
    ai3dStats.textContent = job.preview?.vertexCount ? `${job.preview.vertexCount} vertices` : "Professional GLB ready";
    setDownloadLink(output.glbUrl, "GLB");
  } else {
    ai3dStats.textContent = `${job.preview.vertexCount} vertices`;
    setDownloadLink(output.objUrl, "OBJ");
  }

  if (job.preview) set3dModel(job.preview);
}

const viewer3d = {
  gl: null,
  program: null,
  positionBuffer: null,
  colorBuffer: null,
  indexBuffer: null,
  indexCount: 0,
  vertexCount: 0,
  yaw: -0.55,
  pitch: -0.72,
  zoom: 4.9,
  dragging: false,
  lastX: 0,
  lastY: 0,
  animationFrame: null
};

function createShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader));
  }

  return shader;
}

function init3dViewer() {
  if (viewer3d.gl || !ai3dPreview) return;

  const gl = ai3dPreview.getContext("webgl", { antialias: true });
  if (!gl) {
    ai3dStats.textContent = "WebGL unavailable";
    return;
  }

  const vertexShader = createShader(gl, gl.VERTEX_SHADER, `
    attribute vec3 aPosition;
    attribute vec3 aColor;
    uniform float uYaw;
    uniform float uPitch;
    uniform float uZoom;
    uniform float uAspect;
    varying vec3 vColor;

    vec3 rotateY(vec3 p, float a) {
      float c = cos(a);
      float s = sin(a);
      return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
    }

    vec3 rotateX(vec3 p, float a) {
      float c = cos(a);
      float s = sin(a);
      return vec3(p.x, c * p.y - s * p.z, s * p.y + c * p.z);
    }

    void main() {
      vec3 p = rotateX(rotateY(aPosition, uYaw), uPitch);
      float z = p.z + uZoom;
      float scale = 1.85 / max(z, 0.2);
      gl_Position = vec4(p.x * scale / uAspect, (p.y - 0.16) * scale, (z - 1.0) / 8.0, 1.0);
      vColor = aColor * (0.72 + clamp(p.y, 0.0, 1.0) * 0.55);
    }
  `);

  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, `
    precision mediump float;
    varying vec3 vColor;

    void main() {
      gl_FragColor = vec4(vColor, 1.0);
    }
  `);

  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program));
  }

  viewer3d.gl = gl;
  viewer3d.program = program;
  viewer3d.positionBuffer = gl.createBuffer();
  viewer3d.colorBuffer = gl.createBuffer();
  viewer3d.indexBuffer = gl.createBuffer();

  ai3dPreview.addEventListener("pointerdown", (event) => {
    viewer3d.dragging = true;
    viewer3d.lastX = event.clientX;
    viewer3d.lastY = event.clientY;
    ai3dPreview.setPointerCapture(event.pointerId);
  });

  ai3dPreview.addEventListener("pointermove", (event) => {
    if (!viewer3d.dragging) return;
    const dx = event.clientX - viewer3d.lastX;
    const dy = event.clientY - viewer3d.lastY;
    viewer3d.yaw += dx * 0.01;
    viewer3d.pitch = Math.max(-1.35, Math.min(-0.18, viewer3d.pitch + dy * 0.01));
    viewer3d.lastX = event.clientX;
    viewer3d.lastY = event.clientY;
  });

  ai3dPreview.addEventListener("pointerup", () => {
    viewer3d.dragging = false;
  });

  ai3dPreview.addEventListener("pointercancel", () => {
    viewer3d.dragging = false;
  });

  ai3dPreview.addEventListener("wheel", (event) => {
    event.preventDefault();
    viewer3d.zoom = Math.max(3.2, Math.min(7.2, viewer3d.zoom + event.deltaY * 0.004));
  }, { passive: false });

  render3dPreview();
}

function resize3dPreview() {
  if (!ai3dPreview) return;

  const rect = ai3dPreview.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  const width = Math.max(240, Math.round(rect.width * scale));
  const height = Math.max(180, Math.round(rect.height * scale));

  if (ai3dPreview.width !== width || ai3dPreview.height !== height) {
    ai3dPreview.width = width;
    ai3dPreview.height = height;
  }
}

function set3dModel(preview) {
  init3dViewer();
  resize3dPreview();

  const gl = viewer3d.gl;
  if (!gl) return;

  const vertices = new Float32Array(preview.vertices);
  const colors = new Float32Array(preview.colors);
  const indices = new Uint16Array(preview.indices);

  gl.bindBuffer(gl.ARRAY_BUFFER, viewer3d.positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

  gl.bindBuffer(gl.ARRAY_BUFFER, viewer3d.colorBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, colors, gl.STATIC_DRAW);

  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, viewer3d.indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

  viewer3d.indexCount = indices.length;
  viewer3d.vertexCount = preview.vertexCount;
}

function reset3dView() {
  viewer3d.yaw = -0.55;
  viewer3d.pitch = -0.72;
  viewer3d.zoom = 4.9;
}

function render3dPreview() {
  const gl = viewer3d.gl;

  if (gl) {
    resize3dPreview();
    gl.viewport(0, 0, ai3dPreview.width, ai3dPreview.height);
    gl.clearColor(0.965, 0.975, 0.99, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(viewer3d.program);

    if (viewer3d.indexCount > 0) {
      if (!viewer3d.dragging) viewer3d.yaw += 0.003;

      const positionLocation = gl.getAttribLocation(viewer3d.program, "aPosition");
      const colorLocation = gl.getAttribLocation(viewer3d.program, "aColor");

      gl.bindBuffer(gl.ARRAY_BUFFER, viewer3d.positionBuffer);
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, viewer3d.colorBuffer);
      gl.enableVertexAttribArray(colorLocation);
      gl.vertexAttribPointer(colorLocation, 3, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, viewer3d.indexBuffer);
      gl.uniform1f(gl.getUniformLocation(viewer3d.program, "uYaw"), viewer3d.yaw);
      gl.uniform1f(gl.getUniformLocation(viewer3d.program, "uPitch"), viewer3d.pitch);
      gl.uniform1f(gl.getUniformLocation(viewer3d.program, "uZoom"), viewer3d.zoom);
      gl.uniform1f(gl.getUniformLocation(viewer3d.program, "uAspect"), ai3dPreview.width / ai3dPreview.height);
      gl.drawElements(gl.TRIANGLES, viewer3d.indexCount, gl.UNSIGNED_SHORT, 0);
    }
  }

  viewer3d.animationFrame = window.requestAnimationFrame(render3dPreview);
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

aiDepth.addEventListener("input", () => {
  aiDepthValue.textContent = aiDepth.value;
});

aiSmooth.addEventListener("input", () => {
  aiSmoothValue.textContent = aiSmooth.value;
});

aiRunner.addEventListener("change", updateRunnerNote);

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

exportCanvas3dBtn.addEventListener("click", () => {
  const link = document.createElement("a");
  link.download = "canvas-studio-source.png";
  link.href = canvas.toDataURL("image/png");
  link.click();
});

generate3dBtn.addEventListener("click", createAi3dJob);
reset3dViewBtn.addEventListener("click", reset3dView);
window.addEventListener("resize", resize3dPreview);

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
init3dViewer();
