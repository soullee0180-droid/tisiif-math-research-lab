import json
from pathlib import Path
from lab.api.app import app
path=Path("docs/openapi.json")
path.parent.mkdir(exist_ok=True)
path.write_text(json.dumps(app.openapi(),ensure_ascii=False,indent=2)+"\n")
print("Generated docs/openapi.json from the running API contract.")

