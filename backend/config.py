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
REASONING_LEVELS = ("low", "medium", "xhigh")

MODELS = {
    DEFAULT_MODEL: {
        "label": "Qwen 3.8 27B",
        "repo": "ukisai/Swift-1.5-Qwen3.8-27B-GSQ-RCO-GGUF",
        "file": "Swift-1.5-Qwen3.8-27B-GSQ-RCO-IQ3_XXS-mtp.gguf",
        "ctx": 131072,
        "reasoning": True,  # The chat template opens <think> in the prompt.
        "size_gb": 10.44,
        "min_vram_gb": 12,
        "min_ram_gb": 12,
        "arch": "Dense Transformer",
        "quant": "Dynamic QAT",
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
