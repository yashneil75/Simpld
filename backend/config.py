"""Shared paths and model catalogue for the Simpld backend."""

import os
from pathlib import Path

MODEL_DIR = Path(os.environ.get("SIMPLD_MODEL_DIR", Path.home() / ".simpld"))
MODEL_DIR.mkdir(parents=True, exist_ok=True)

WORKSPACE = MODEL_DIR / "workspace"
WORKSPACE.mkdir(parents=True, exist_ok=True)

PORT = int(os.environ.get("SIMPLD_PORT", "8000"))

DEFAULT_MODEL = "Kintsugi-27b"

MODELS = {
    DEFAULT_MODEL: {
        "label": "Kintsugi 27B",
        "repo": "CaryPalmer/Kintsugi-27B",
        "file": "Kintsugi-27B-12G.gguf",
        # TEMP: reduced to 5K (5120) for testing. Change back to 131072 (128K) when done.
        "ctx": 5120,
        "size_gb": 11.66,
        "min_vram_gb": 16,
        "min_ram_gb": 24,
        "arch": "Inkling 2 (looped MoE)",
        "quant": "UD-IQ3_XXS",
        "description": "Local text chat and coding",
    },
}
