#!/usr/bin/env python3
"""Run: python reassemble-export.py tisiif-*-manifest.json [output-directory]."""
import hashlib
import json
from pathlib import Path
import sys
import zipfile

manifest_path = Path(sys.argv[1]).resolve()
manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
output = Path(sys.argv[2] if len(sys.argv) > 2 else 'reassembled').resolve()
output.mkdir(parents=True, exist_ok=True)
parts = []
for part in manifest['parts']:
    path = manifest_path.parent / part['name']
    if path.parent != manifest_path.parent:
        raise ValueError('Unsafe part name')
    raw = path.read_bytes()
    if len(raw) != part['bytes'] or hashlib.sha256(raw).hexdigest() != part['sha256']:
        raise ValueError('Part integrity failure: ' + part['name'])
    parts.append(zipfile.ZipFile(path))
try:
    for item in manifest['files']:
        target = (output / item['path']).resolve()
        if output not in target.parents:
            raise ValueError('Unsafe file path')
        chunks = []
        for chunk in item['chunks']:
            raw = parts[chunk['part']].read(chunk['entry'])
            if len(raw) != chunk['bytes'] or hashlib.sha256(raw).hexdigest() != chunk['sha256']:
                raise ValueError('Chunk integrity failure')
            chunks.append(raw)
        raw = b''.join(chunks)
        if len(raw) != item['bytes'] or hashlib.sha256(raw).hexdigest() != item['sha256']:
            raise ValueError('File integrity failure')
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(raw)
finally:
    for part in parts:
        part.close()
print('Verified files written to', output)
