#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODEL_DIR="${SF3D_DIR:-"$ROOT_DIR/models/stable-fast-3d"}"
REPO_URL="https://github.com/Stability-AI/stable-fast-3d.git"

mkdir -p "$(dirname "$MODEL_DIR")"

if [ ! -d "$MODEL_DIR/.git" ]; then
  git clone "$REPO_URL" "$MODEL_DIR"
else
  git -C "$MODEL_DIR" pull --ff-only
fi

python3 -m venv "$MODEL_DIR/.venv"
"$MODEL_DIR/.venv/bin/python" -m pip install --upgrade pip setuptools==69.5.1 wheel
"$MODEL_DIR/.venv/bin/python" -m pip install torch torchvision
(
  cd "$MODEL_DIR"
  "$MODEL_DIR/.venv/bin/python" -m pip install --no-build-isolation -r requirements.txt
)
"$MODEL_DIR/.venv/bin/python" -m pip install huggingface_hub

if [ -n "${HF_TOKEN:-}" ]; then
  "$MODEL_DIR/.venv/bin/huggingface-cli" login --token "$HF_TOKEN" --add-to-git-credential
else
  cat <<'MSG'

Stable Fast 3D is installed, but its model weights are gated on Hugging Face.

Next:
1. Request access to stabilityai/stable-fast-3d on Hugging Face.
2. Create a read token.
3. Run:
   export HF_TOKEN=your_token_here
   bash scripts/setup-sf3d.sh

Apple Silicon note:
Stable Fast 3D's README says MPS support is experimental and may need the
OpenMP runtime for clang -fopenmp support.
MSG
fi
