"""Place CUDA redistributables beside llama_cpp before freezing."""

from importlib.metadata import distribution
import os
from pathlib import Path
import shutil
import sys


def main() -> None:
    # Locate the package without importing it: its DLLs cannot load until the
    # CUDA dependencies are installed beside them.
    target = Path(distribution("llama-cpp-python").locate_file("llama_cpp/lib"))
    if not target.is_dir():
        raise RuntimeError(f"llama_cpp native library directory is missing: {target}")

    for name in ("nvidia-cuda-runtime-cu12", "nvidia-cublas-cu12"):
        package = distribution(name)
        copied = []
        for entry in package.files or ():
            source = Path(package.locate_file(entry))
            if source.suffix == ".dll" or ".so" in source.suffixes:
                shutil.copy2(source, target / source.name)
                copied.append(source.name)
            elif "license" in source.name.lower() or source.name.lower().startswith("notice"):
                licenses = target / "licenses" / name
                licenses.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, licenses / source.name)
        if not copied:
            raise RuntimeError(f"No runtime libraries found in {name}")
        print(f"{name}: {', '.join(copied)}")

    # ELF dependencies need to find these libraries during
    # PyInstaller's dependency analysis. PyInstaller then bundles them itself.
    if sys.platform.startswith("linux") and (env_file := os.environ.get("GITHUB_ENV")):
        search = os.pathsep.join(filter(None, (str(target), os.environ.get("LD_LIBRARY_PATH"))))
        with Path(env_file).open("a", encoding="utf-8") as output:
            output.write(f"LD_LIBRARY_PATH={search}\n")


if __name__ == "__main__":
    main()
