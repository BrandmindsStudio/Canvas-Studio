# Canvas Studio

A simple Apple-inspired web paint app built with plain HTML, CSS, and JavaScript, with a local AI 3D job server.

## Run locally

```bash
npm start
```

Then open `http://127.0.0.1:5174/`.

## Features

- Brush and eraser tools
- Lines, rectangles, ellipses, fill, text, and color picker
- Color swatches and brush size control
- Undo and redo with visible history state
- PNG download
- Professional local AI 3D path through Stable Fast 3D
- Fast fallback relief mesh for app-flow testing
- WebGL 3D preview for fallback meshes, OBJ export, and GLB download for SF3D output

## AI 3D runners

Canvas Studio has two local 3D runners:

- **Professional SF3D**: calls a local Stable Fast 3D checkout and returns a real `.glb` model.
- **Fast preview relief**: creates a quick OBJ height-field preview from the canvas. This is useful for testing the app flow, but it is not professional model generation.

The backend is shaped like an async model runner:

- `POST /api/ai3d/jobs`
- `GET /api/ai3d/jobs/:id`
- generated assets in `generated/`

### Stable Fast 3D setup

Stable Fast 3D is gated on Hugging Face. The setup script installs the runner, but professional generation will not work until model-weight access is approved and the local server can see a Hugging Face token or login.

Request access to `stabilityai/stable-fast-3d`, create a read token, then run:

```bash
export HF_TOKEN=your_token_here
bash scripts/setup-sf3d.sh
```

Then restart Canvas Studio:

```bash
npm start
```

If you already installed the runner but skipped the token, run the same `export HF_TOKEN=...` command and then `bash scripts/setup-sf3d.sh` again. The script reuses the checkout and logs the local virtual environment into Hugging Face.

The server checks `models/stable-fast-3d/.venv/bin/python` by default. You can override with:

```bash
SF3D_DIR=/path/to/stable-fast-3d SF3D_PYTHON=/path/to/python npm start
```
