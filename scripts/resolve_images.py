"""Run on a trusted Docker-capable CI runner; never downloads credentials."""
import hashlib,json,os,re,subprocess
from pathlib import Path
images=['node:24-bookworm-slim','python:3.12-slim-bookworm','ghcr.io/astral-sh/uv:0.13.4']
resolved={}
for image in images:
    subprocess.run(['docker','pull',image],check=True,stdout=subprocess.DEVNULL)
    info=json.loads(subprocess.check_output(['docker','image','inspect',image]))[0]
    resolved[image]=info['RepoDigests'][0]
manifest={'schema_version':1,'source_commit':os.getenv('GITHUB_SHA'),'base_images':resolved,
    'lockfiles':{p:hashlib.sha256(Path(p).read_bytes()).hexdigest() for p in ['uv.lock','apps/web/package-lock.json']},
    'live_ai_requests':0}
Path('build-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
text=Path('Dockerfile').read_text()
for key,image in zip(['NODE_IMAGE','PYTHON_IMAGE','UV_IMAGE'],images):
    text=re.sub(r'^ARG '+key+r'=.*$',lambda _: 'ARG '+key+'='+resolved[image],text,flags=re.M)
Path('Dockerfile').write_text(text)
