"""Keep the standalone specification validator separate from installed dependencies."""
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
root=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory() as d:
    target=Path(d)
    shutil.copyfile(root/"01_MASTER_PROMPT.md",target/"01_MASTER_PROMPT.md")
    for name in ("contracts","fixtures","verification"):
        shutil.copytree(root/name,target/name)
    subprocess.run([sys.executable,str(target/"verification/check_contracts.py")],check=True)

