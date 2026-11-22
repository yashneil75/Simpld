"""Coverage for the model catalogue and download transitions."""

import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from backend import config
from backend import download

MODEL = config.DEFAULT_MODEL


class LibraryTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.addCleanup(download._progress.clear)
        patcher = patch.object(config, "MODEL_DIR", Path(directory.name))
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_catalogue_displays_exact_requested_artifact(self):
        self.assertEqual(list(config.MODELS), [MODEL, "Ornith-1.5-9B"])
        spec = config.MODELS[MODEL]
        self.assertEqual(spec["repo"], "ukisai/Swift-1.5-Qwen3.8-27B-GSQ-RCO-GGUF")
        self.assertEqual(spec["file"], "Swift-1.5-Qwen3.8-27B-GSQ-RCO-IQ3_XXS-mtp.gguf")
        entry, ornith = download.library()
        self.assertEqual(entry["label"], "Qwen 3.8 27B")
        self.assertFalse(entry["downloaded"])
        self.assertEqual(config.MODELS[ornith["id"]]["file"], "Ornith-1.5-9B-Q5_K_M.gguf")
        self.assertEqual(ornith["repo"], "ornith-ai/Ornith-1.5-9B-GGUF")
        self.assertEqual(ornith["quant"], "Q5_K_M")

    def test_discover_and_delete_nested_artifact(self):
        path = config.MODEL_DIR / "manually-downloaded" / config.MODELS[MODEL]["file"]
        path.parent.mkdir()
        path.write_bytes(b"weights")
        self.assertEqual(download.find_local(MODEL), path)
        self.assertEqual(download.library()[0]["size_bytes"], 7)
        self.assertTrue(download.delete(MODEL))
        self.assertFalse(download.delete(MODEL))

    def test_old_model_ids_are_rejected(self):
        for name in ("lite", "medium", "pro", "inkling-2-mini"):
            with self.subTest(name=name), self.assertRaises(ValueError):
                download.start_download(name)

    def wait_for_terminal(self):
        with download._changed:
            entry = download._progress[MODEL]
            self.assertTrue(download._changed.wait_for(
                lambda: entry["status"] not in download._ACTIVE, timeout=5,
            ))
            return entry["status"]

    @patch("backend.download.requests.get")
    def test_duplicate_start_and_cancel_are_serialized_and_retryable(self, get):
        entered = threading.Event()
        release = threading.Event()

        def chunks(**_kwargs):
            entered.set()
            release.wait(timeout=5)
            yield b"GGUFok!"

        result = get.return_value.__enter__.return_value
        result.headers = {"Content-Length": "7"}
        result.iter_content.side_effect = chunks
        download.start_download(MODEL)
        try:
            self.assertTrue(entered.wait(timeout=5))
            self.assertEqual(download.start_download(MODEL)["status"], "downloading")
            download.cancel_download(MODEL)
            self.assertEqual(download.start_download(MODEL)["status"], "cancelling")
        finally:
            release.set()
        self.assertEqual(self.wait_for_terminal(), "cancelled")
        self.assertEqual(list(config.MODEL_DIR.rglob("*.part")), [])
        self.assertEqual(get.call_count, 1)
        download.cancel_download(MODEL)  # A repeated cancel must not poison the retry.
        self.assertEqual(download.download(MODEL).read_bytes(), b"GGUFok!")
        self.assertEqual(self.wait_for_terminal(), "done")
        self.assertEqual(get.call_count, 2)

    @patch("backend.download.requests.get")
    def test_truncated_download_never_enters_library(self, get):
        result = get.return_value.__enter__.return_value
        result.headers = {"Content-Length": "100"}
        result.iter_content.return_value = [b"partial"]
        with self.assertRaisesRegex(RuntimeError, "complete file"):
            download.download(MODEL)
        self.assertEqual(self.wait_for_terminal(), "error")
        self.assertFalse(download.is_downloaded(MODEL))
