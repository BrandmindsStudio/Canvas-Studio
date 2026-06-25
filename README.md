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
- Local AI 3D relief mesh generation
- WebGL 3D preview and OBJ export

## AI 3D

The first AI 3D lane runs locally through `server.js`. It turns the current canvas into a sampled height field, creates a real OBJ mesh, and previews it in the browser.

The backend is intentionally shaped like an async model runner:

- `POST /api/ai3d/jobs`
- `GET /api/ai3d/jobs/:id`
- generated assets in `generated/`

That makes it ready for a Mac mini model runner such as Stable Fast 3D or Hunyuan3D once the local Python environment is installed.
