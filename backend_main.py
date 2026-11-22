"""PyInstaller entry point for the Simpld backend.

Build:  pyinstaller --noconfirm --clean --name simpld-backend --onedir ^
            --console --distpath dist-backend --workpath build-backend backend_main.py

The frozen executable uses the same entry point as `python -m backend.app`.
"""

from backend.app import main

if __name__ == "__main__":
    main()
