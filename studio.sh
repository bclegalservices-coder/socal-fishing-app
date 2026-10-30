#!/bin/bash
# Channel Nav Map Studio — start it with:   bash studio.sh
# First time: installs "uv" (a small Python helper) and the map-drawing tools into ~/.channelnav-studio (a few minutes).
# After that it starts in a few seconds and opens http://localhost:8765 in your browser. Control+C stops it.
set -e
cd "$(dirname "$0")"
HOME_DIR="$HOME/.channelnav-studio"
VENV="$HOME_DIR/venv"
mkdir -p "$HOME_DIR"

if ! command -v uv >/dev/null 2>&1 && [ ! -x "$HOME/.local/bin/uv" ] && [ ! -x "$HOME/.cargo/bin/uv" ]; then
  echo "→ Installing uv (one time)…"
  curl -LsSf https://astral.sh/uv/install.sh | sh
fi
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"

if [ ! -x "$VENV/bin/python" ]; then
  echo "→ Setting up Python 3.12 for the Studio (one time)…"
  uv venv --python 3.12 "$VENV"
fi
STAMP="$HOME_DIR/.installed-v1"
if [ ! -f "$STAMP" ]; then
  echo "→ Installing the map tools (one time, a few minutes)…"
  uv pip install --python "$VENV/bin/python" "fastapi>=0.115" "uvicorn>=0.30" "httpx>=0.27" "numpy>=1.26" "scipy>=1.11" \
    "pillow>=10.0" "rasterio>=1.3" "contourpy>=1.2"
  touch "$STAMP"
fi

cd api
exec "$VENV/bin/python" -m studio
