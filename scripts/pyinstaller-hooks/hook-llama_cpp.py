"""Collect native inference libraries without loading the GPU driver in CI."""

from importlib.metadata import distribution
from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files


package = distribution("llama-cpp-python")
root = Path(package.locate_file(""))
datas = collect_data_files("llama_cpp")
binaries = []
for directory in (root / "llama_cpp", root / "llama_cpp_python.libs"):
    if directory.is_dir():
        for path in directory.rglob("*"):
            if path.is_file() and (path.suffix in {".dll", ".dylib"} or ".so" in path.suffixes):
                binaries.append((str(path), str(path.parent.relative_to(root))))
