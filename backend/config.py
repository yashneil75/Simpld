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
        "label": "Qwen 3.8 27B",
        "repo": "ukisai/Swift-1.5-Qwen3.8-27B-GSQ-RCO-GGUF",
        "file": "Swift-1.5-Qwen3.8-27B-GSQ-RCO-IQ3_XXS-mtp.gguf",
        "ctx": 131072,
        "size_gb": 10.44,
        "min_vram_gb": 12,
        "min_ram_gb": 12,
        "arch": "Dense Transformer",
        "quant": "Dynamic QAT",
        "description": "Local text chat and coding",
    },
}
