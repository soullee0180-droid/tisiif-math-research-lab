from pypdf import PdfReader
r=PdfReader('test-results/prepared-canary.pdf');assert len(r.pages)==1
assert not ''.join(p.extract_text() or '' for p in r.pages).strip()
assert all(not p.get('/Annots') for p in r.pages)
assert not list(r.attachments)
assert 'PRIVATE' not in str(r.metadata)
assert '/JavaScript' not in str(r.trailer['/Root'].get('/Names',{}))
print('PASS independent pypdf image-only canary verification')
