"""Shared paths and model catalogue for the Simpld backend."""

import os
from pathlib import Path

MODEL_DIR = Path(os.environ.get("SIMPLD_MODEL_DIR", Path.home() / ".simpld"))
MODEL_DIR.mkdir(parents=True, exist_ok=True)

WORKSPACE = MODEL_DIR / "workspace"
WORKSPACE.mkdir(parents=True, exist_ok=True)

PORT = int(os.environ.get("SIMPLD_PORT", "8000"))

DEFAULT_MODEL = "Kintsugi-27b"

# Native reasoning_effort values accepted by the GGUF's chat template.
REASONING_LEVELS = ("medium", "xhigh")

MODELS = {
    DEFAULT_MODEL: {
        "label": "Bonsai 2.5 27B",
        "repo": "prism-ml/Ternary-Bonsai-2.5-27B-GGUF",
        "file": "Ternary-Bonsai-2.5-27B-Q2_0-mtp.gguf",
        "ctx": 131072,
        "reasoning": True,
        "size_gb": 10.44,
        "min_vram_gb": 12,
        "min_ram_gb": 12,
        "arch": "Dense Transformer",
        "quant": "Q2_0 Bonsai Special",
        "description": "Local text chat and coding",
    },
    "Ornith-1.5-9B": {
        "label": "Ornith 1.5 9B",
        "repo": "ornith-ai/Ornith-1.5-9B-GGUF",
        "file": "Ornith-1.5-9B-Q5_K_M.gguf",
        "ctx": 131072,
        "reasoning": True,
        "reasoning_levels": [],
        "size_gb": 6.64,
        "min_vram_gb": 8,
        "min_ram_gb": 10,
        "arch": "Qwen3.5",
        "quant": "Q5_K_M",
        "description": "Ornith's official Q5_K_M GGUF for local chat and coding",
        "sampling": {"temperature": 0.6, "top_p": 0.95, "top_k": 20,
                     "min_p": 0.0, "presence_penalty": 0.0, "repeat_penalty": 1.0},
    },
}
