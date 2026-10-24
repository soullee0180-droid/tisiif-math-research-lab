import pathlib,json
root=pathlib.Path(__file__).resolve().parents[1]
excluded={'node_modules','.git','dist','.edge-bundle','vendor','test-results','playwright-report'}
tree=[]
for p in sorted(root.rglob('*')):
 if not p.is_file() or any(part in excluded for part in p.relative_to(root).parts):continue
 if p.name.startswith('.env') and p.name!='.env.example':continue
 try:content=p.read_text()
 except UnicodeDecodeError:continue
 tree.append({'path':p.relative_to(root).as_posix(),'mode':'100644','type':'blob','content':content})
print(json.dumps(tree,ensure_ascii=False))
