const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 5174);
const HOST = process.env.HOST || "127.0.0.1";
const ROOT = __dirname;
const GENERATED_DIR = path.join(ROOT, "generated");
const MODELS_DIR = path.join(ROOT, "models");
const DEFAULT_SF3D_DIR = path.join(MODELS_DIR, "stable-fast-3d");
const jobs = new Map();

fs.mkdirSync(GENERATED_DIR, { recursive: true });

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".obj": "text/plain; charset=utf-8",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

function sendJson(response, status, data) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(data));
}

function sendText(response, status, text) {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(text);
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 8_000_000) {
        request.destroy();
        reject(new Error("Request body too large"));
      }
    });

    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function fileExists(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function getHfAccessState() {
  const homeDir = os.homedir();
  const hfHome = process.env.HF_HOME || path.join(homeDir, ".cache", "huggingface");
  const tokenFiles = [
    path.join(hfHome, "token"),
    path.join(homeDir, ".huggingface", "token")
  ];
  const cachedWeights = path.join(hfHome, "hub", "models--stabilityai--stable-fast-3d");

  if (process.env.HF_TOKEN || process.env.HUGGING_FACE_HUB_TOKEN) {
    return { ready: true, source: "environment token" };
  }

  if (tokenFiles.some(fileExists)) {
    return { ready: true, source: "Hugging Face login" };
  }

  if (fileExists(cachedWeights)) {
    return { ready: true, source: "cached model weights" };
  }

  return { ready: false, source: null };
}

function getSf3dConfig() {
  const sf3dDir = process.env.SF3D_DIR || DEFAULT_SF3D_DIR;
  const venvPython = path.join(sf3dDir, ".venv", "bin", "python");
  const python = process.env.SF3D_PYTHON || (fileExists(venvPython) ? venvPython : "python3");
  const runPy = path.join(sf3dDir, "run.py");
  const missing = [];
  const hfAccess = getHfAccessState();

  if (!fileExists(sf3dDir)) missing.push(`missing repo at ${path.relative(ROOT, sf3dDir)}`);
  if (!fileExists(runPy)) missing.push("missing run.py");
  if (!fileExists(venvPython) && !process.env.SF3D_PYTHON) missing.push("missing .venv Python");

  const installed = missing.length === 0;
  const available = installed && hfAccess.ready;
  const message = (() => {
    if (!installed) {
      return `Stable Fast 3D is not ready: ${missing.join(", ")}. Run scripts/setup-sf3d.sh after Hugging Face access is approved.`;
    }

    if (!hfAccess.ready) {
      return "Stable Fast 3D is installed, but gated model access is missing. Add HF_TOKEN or run huggingface-cli login, then restart npm start.";
    }

    return `Stable Fast 3D runner is ready via ${hfAccess.source}. This will generate a real GLB.`;
  })();

  return {
    available,
    installed,
    authReady: hfAccess.ready,
    dir: sf3dDir,
    python,
    runPy,
    missing,
    message
  };
}

function getCapabilities() {
  const sf3d = getSf3dConfig();

  return {
    ok: true,
    runners: {
      sf3d: {
        available: sf3d.available,
        installed: sf3d.installed,
        authReady: sf3d.authReady,
        message: sf3d.message,
        dir: path.relative(ROOT, sf3d.dir) || "."
      },
      relief: {
        available: true,
        message: "Fast local preview mesh. Not professional model generation."
      }
    }
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function hashNumber(text) {
  const hash = crypto.createHash("sha256").update(text || "canvas-studio").digest();
  return hash.readUInt32LE(0);
}

function createRandom(seed) {
  let state = seed >>> 0;

  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;

  if (hp >= 0 && hp < 1) [r, g, b] = [c, x, 0];
  if (hp >= 1 && hp < 2) [r, g, b] = [x, c, 0];
  if (hp >= 2 && hp < 3) [r, g, b] = [0, c, x];
  if (hp >= 3 && hp < 4) [r, g, b] = [0, x, c];
  if (hp >= 4 && hp < 5) [r, g, b] = [x, 0, c];
  if (hp >= 5 && hp < 6) [r, g, b] = [c, 0, x];

  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255)
  ];
}

function smoothHeights(heights, width, height, iterations) {
  let current = heights;

  for (let pass = 0; pass < iterations; pass += 1) {
    const next = new Array(current.length).fill(0);

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let total = 0;
        let count = 0;

        for (let oy = -1; oy <= 1; oy += 1) {
          for (let ox = -1; ox <= 1; ox += 1) {
            const px = x + ox;
            const py = y + oy;

            if (px >= 0 && px < width && py >= 0 && py < height) {
              total += current[py * width + px];
              count += 1;
            }
          }
        }

        next[y * width + x] = total / count;
      }
    }

    current = next;
  }

  return current;
}

function writeDataUrlToFile(dataUrl, filePath) {
  const match = String(dataUrl || "").match(/^data:image\/png;base64,(.+)$/);
  if (!match) throw new Error("Missing canvas PNG input");
  fs.writeFileSync(filePath, Buffer.from(match[1], "base64"));
}

function findGeneratedModel(jobDir) {
  const entries = fs.readdirSync(jobDir, { recursive: true });
  const files = entries
    .map((entry) => path.join(jobDir, entry))
    .filter((entryPath) => fs.statSync(entryPath).isFile());

  return files.find((filePath) => filePath.endsWith(".glb"))
    || files.find((filePath) => filePath.endsWith(".obj"))
    || null;
}

function runCommand(command, args, options, onProgress) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      onProgress?.(stdout, stderr);
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      onProgress?.(stdout, stderr);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const detail = (stderr || stdout || "").split("\n").slice(-12).join("\n").trim();
      reject(new Error(`SF3D exited with code ${code}${detail ? `: ${detail}` : ""}`));
    });
  });
}

async function runSf3d(payload, jobId, job) {
  const config = getSf3dConfig();
  if (!config.available) throw new Error(config.message);

  const jobDir = path.join(GENERATED_DIR, jobId);
  fs.mkdirSync(jobDir, { recursive: true });

  const inputPath = path.join(jobDir, "input.png");
  writeDataUrlToFile(payload.canvasPng, inputPath);

  job.progress = 8;
  job.message = "Saved canvas input";

  const args = [
    config.runPy,
    inputPath,
    "--output-dir",
    jobDir,
    "--texture-resolution",
    String(process.env.SF3D_TEXTURE_RESOLUTION || 1024),
    "--remesh_option",
    process.env.SF3D_REMESH_OPTION || "triangle"
  ];

  await runCommand(config.python, args, {
    cwd: config.dir,
    env: {
      ...process.env,
      PYTORCH_ENABLE_MPS_FALLBACK: "1"
    }
  }, () => {
    job.progress = Math.max(job.progress, 45);
    job.message = "Running Stable Fast 3D";
  });

  const modelPath = findGeneratedModel(jobDir);
  if (!modelPath) throw new Error("SF3D finished but no GLB/OBJ was found in the output directory");

  const outputUrl = `/${path.relative(ROOT, modelPath).split(path.sep).join("/")}`;
  const isGlb = modelPath.endsWith(".glb");

  return {
    output: isGlb ? { glbUrl: outputUrl } : { objUrl: outputUrl },
    preview: null
  };
}

function createPromptHeights(width, height, prompt) {
  const seed = hashNumber(prompt);
  const random = createRandom(seed);
  const lobes = Array.from({ length: 5 }, () => ({
    x: random(),
    y: random(),
    radius: 0.14 + random() * 0.24,
    lift: 0.28 + random() * 0.58
  }));

  const heights = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const nx = x / (width - 1);
      const ny = y / (height - 1);
      let value = 0;

      for (const lobe of lobes) {
        const dx = nx - lobe.x;
        const dy = ny - lobe.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        value += Math.max(0, 1 - dist / lobe.radius) * lobe.lift;
      }

      const edge = Math.sin(nx * Math.PI) * Math.sin(ny * Math.PI);
      heights.push(clamp(value * edge, 0, 1));
    }
  }

  return heights;
}

function buildMesh(payload, jobId) {
  const prompt = payload.prompt || "canvas studio object";
  const source = payload.source || {};
  const width = clamp(Number(source.width || 72), 24, 96);
  const height = clamp(Number(source.height || 46), 16, 72);
  const samples = Array.isArray(source.samples) ? source.samples : [];
  const hasCanvasInk = Number(source.maxInk || 0) > 0.025 && samples.length >= width * height;
  const depthScale = 0.12 + clamp(Number(payload.depth || 55), 12, 100) / 100;
  const smooth = clamp(Number(payload.smooth || 2), 0, 5);
  const seedHue = hashNumber(prompt) % 360;
  const promptColor = hslToRgb(seedHue, 0.62, 0.56);

  let heights = hasCanvasInk
    ? samples.slice(0, width * height).map((sample) => clamp(Number(sample.i || 0), 0, 1))
    : createPromptHeights(width, height, prompt);

  heights = smoothHeights(heights, width, height, smooth);

  const maxHeight = Math.max(...heights);
  if (maxHeight > 0) heights = heights.map((value) => value / maxHeight);

  const vertices = [];
  const colors = [];
  const indices = [];
  const objLines = [
    "# Canvas Studio local AI 3D mesh",
    `# Job ${jobId}`,
    `# Prompt ${prompt.replace(/\s+/g, " ").slice(0, 140)}`,
    "o canvas_studio_ai3d"
  ];

  const aspect = height / width;
  const xSize = 4;
  const zSize = Math.max(1.6, xSize * aspect);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const sx = x / (width - 1);
      const sy = y / (height - 1);
      const lift = heights[index] * depthScale;
      const vx = (sx - 0.5) * xSize;
      const vy = lift;
      const vz = (sy - 0.5) * zSize;
      const sample = samples[index] || {};
      const r = hasCanvasInk ? Math.round(clamp(Number(sample.r ?? promptColor[0]), 0, 255)) : promptColor[0];
      const g = hasCanvasInk ? Math.round(clamp(Number(sample.g ?? promptColor[1]), 0, 255)) : promptColor[1];
      const b = hasCanvasInk ? Math.round(clamp(Number(sample.b ?? promptColor[2]), 0, 255)) : promptColor[2];
      const shade = 0.62 + heights[index] * 0.38;
      const cr = clamp((r * shade + 255 * (1 - heights[index]) * 0.12) / 255, 0.08, 1);
      const cg = clamp((g * shade + 255 * (1 - heights[index]) * 0.12) / 255, 0.08, 1);
      const cb = clamp((b * shade + 255 * (1 - heights[index]) * 0.12) / 255, 0.08, 1);

      vertices.push(vx, vy, vz);
      colors.push(cr, cg, cb);
      objLines.push(`v ${vx.toFixed(5)} ${vy.toFixed(5)} ${vz.toFixed(5)} ${cr.toFixed(4)} ${cg.toFixed(4)} ${cb.toFixed(4)}`);
    }
  }

  for (let y = 0; y < height - 1; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      const a = y * width + x;
      const b = a + 1;
      const c = a + width;
      const d = c + 1;

      indices.push(a, c, b, b, c, d);
      objLines.push(`f ${a + 1} ${c + 1} ${b + 1}`);
      objLines.push(`f ${b + 1} ${c + 1} ${d + 1}`);
    }
  }

  const objPath = path.join(GENERATED_DIR, `${jobId}.obj`);
  fs.writeFileSync(objPath, `${objLines.join("\n")}\n`);

  return {
    output: {
      objUrl: `/generated/${jobId}.obj`
    },
    preview: {
      vertexCount: width * height,
      vertices,
      colors,
      indices
    }
  };
}

function scheduleJob(payload) {
  const id = crypto.randomUUID();
  const job = {
    id,
    status: "queued",
    progress: 0,
    createdAt: new Date().toISOString()
  };

  jobs.set(id, job);

  setTimeout(async () => {
    try {
      job.status = "running";
      job.progress = 12;
      job.runner = payload.runner === "relief" ? "relief" : "sf3d";
      const result = job.runner === "sf3d"
        ? await runSf3d(payload, id, job)
        : buildMesh(payload, id);
      job.status = "done";
      job.progress = 100;
      job.output = result.output;
      if (result.preview) job.preview = result.preview;
      job.completedAt = new Date().toISOString();
    } catch (error) {
      job.status = "failed";
      job.error = error.message;
      job.progress = 100;
    }
  }, 180);

  return job;
}

function serveStatic(request, response, url) {
  const pathname = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(ROOT, pathname));

  if (!filePath.startsWith(ROOT)) {
    sendText(response, 403, "Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendText(response, 404, "Not found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": pathname.startsWith("/generated/") ? "no-store" : "no-cache"
    });
    response.end(request.method === "HEAD" ? undefined : data);
  });
}

async function handleRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (request.method === "GET" && url.pathname === "/api/ai3d/status") {
    sendJson(response, 200, getCapabilities());
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/ai3d/jobs") {
    try {
      const body = await readRequestBody(request);
      const payload = JSON.parse(body || "{}");
      const job = scheduleJob(payload);
      sendJson(response, 202, job);
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return;
  }

  const jobMatch = url.pathname.match(/^\/api\/ai3d\/jobs\/([a-f0-9-]+)$/);
  if (request.method === "GET" && jobMatch) {
    const job = jobs.get(jobMatch[1]);

    if (!job) {
      sendJson(response, 404, { error: "Job not found" });
      return;
    }

    sendJson(response, 200, job);
    return;
  }

  if (request.method === "GET" || request.method === "HEAD") {
    serveStatic(request, response, url);
    return;
  }

  sendText(response, 405, "Method not allowed");
}

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    sendJson(response, 500, { error: error.message });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Canvas Studio AI server running at http://${HOST}:${PORT}/`);
});
