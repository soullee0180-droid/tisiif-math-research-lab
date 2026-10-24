"""Structure validation is independent from the authenticated Render account validation."""
import json,urllib.request
from pathlib import Path
import yaml
from jsonschema import Draft7Validator
class Loader(yaml.SafeLoader):pass
Loader.yaml_implicit_resolvers={k:[p for p in v if p[0]!='tag:yaml.org,2002:bool'] for k,v in Loader.yaml_implicit_resolvers.items()}
import re
Loader.add_implicit_resolver('tag:yaml.org,2002:bool',re.compile(r'^(?:true|false)$',re.I),list('tTfF'))
with urllib.request.urlopen('https://render.com/schema/render.yaml.json',timeout=30) as response:schema=json.load(response)
data=yaml.load(Path('render.yaml').read_text(),Loader=Loader)
errors=list(Draft7Validator(schema).iter_errors(data))
if errors:raise SystemExit('\n'.join(str(e) for e in errors))
Path('verification-artifacts').mkdir(exist_ok=True)
Path('verification-artifacts/blueprint-validation.json').write_text(json.dumps({'schema_valid':True,'account_validation':'pending_secure_Render_auth','service_count':len(data['services'])}))
print('Render public schema validation passed. Account-aware validation requires Render authentication.')
