import base64
import io
import json
from zipfile import ZipFile
import pytest
from PIL import Image
from pypdf import PdfReader
from reportlab.pdfgen import canvas
from cryptography.exceptions import InvalidTag
from lab.pdf.prepare import inspect_pdf,sanitize,page_image,validate_recipe
from lab.providers.secrets import encrypt,decrypt
from lab.providers.errors import classify
from lab.config import settings
from lab.export.archive import verify_archive,safe_cell
from openpyxl import Workbook

def pdf():
    b=io.BytesIO();c=canvas.Canvas(b,pagesize=(300,300))
    c.drawString(30,150,"HIDDEN_CANARY_123")
    c.drawString(30,260,"PUBLIC")
    c.showPage();c.drawString(30,150,"SECOND");c.save();return b.getvalue()

def test_actual_pdf_redaction_removes_hidden_text_and_pixels():
    raw=pdf();out=sanitize(raw,[{"page":1,"include":True,"rotation":0,
                                "masks":[{"x":0.05,"y":0.4,"w":0.8,"h":0.2}]}])
    assert inspect_pdf(out)==1
    assert "HIDDEN" in PdfReader(io.BytesIO(raw)).pages[0].extract_text()
    assert not PdfReader(io.BytesIO(out)).pages[0].extract_text()
    image=page_image(out,1)
    x,y=image.size
    assert image.getpixel((int(x*0.3),int(y*0.5)))==(0,0,0)

@pytest.mark.parametrize("rotation",[0,90,180,270])
def test_rotated_pdf_has_no_source_layer(rotation):
    out=sanitize(pdf(),[{"page":1,"include":True,"rotation":rotation,"masks":[]}])
    reader=PdfReader(io.BytesIO(out))
    assert reader.metadata.title=="Public research context"
    assert not reader.pages[0].get("/Annots")
    assert not reader.pages[0].extract_text()

@pytest.mark.parametrize("mask",[{"x":-0.1,"y":0,"w":0.2,"h":0.2},{"x":0,"y":0,"w":2,"h":0.2},
                                  {"x":0,"y":0,"w":0,"h":0.2},{"x":float("nan"),"y":0,"w":0.2,"h":0.2}])
def test_invalid_masks_rejected(mask):
    with pytest.raises(ValueError):validate_recipe([{"page":1,"include":True,"rotation":0,"masks":[mask]}],1)

def test_encrypted_and_non_pdf_rejected():
    from pypdf import PdfWriter
    with pytest.raises(ValueError):inspect_pdf(b"not a PDF")
    w=PdfWriter();w.add_blank_page(100,100);w.encrypt("private")
    b=io.BytesIO();w.write(b)
    with pytest.raises(ValueError):inspect_pdf(b.getvalue())

def test_key_cipher_nonce_and_workspace_aad(monkeypatch):
    monkeypatch.setattr(settings(),"secrets_master_key",base64.b64encode(b"x"*32).decode())
    c,n=encrypt("a-new-key-format","workspace","google")
    row=dict(ciphertext=c,nonce=n,workspace_id="workspace",provider="google")
    assert decrypt(row)=="a-new-key-format"
    assert encrypt("a-new-key-format","workspace","google")[1]!=n
    with pytest.raises(InvalidTag):decrypt({**row,"workspace_id":"other"})

@pytest.mark.parametrize("status,body,kind",[
 (401,"bad","credential_blocked"),(402,"billing","payment_blocked"),(403,"region","permission_blocked"),
 (429,"requests per minute","rate_transient"),(429,"requests per day","quota_daily"),
 (429,"insufficient_quota","spend_blocked"),(429,"unknown","quota_unknown"),
 (500,"internal error","remote_unknown"),(529,"overloaded","remote_unknown"),(413,"large","input_size")])
def test_error_classes_are_not_all_retried(status,body,kind):
    assert classify(status,body).error_class==kind
    if status>=500:assert classify(status,body).remote_uncertain

@pytest.mark.parametrize("value",["=1+1","+cmd","-formula","@SUM(A1)","  =HYPERLINK(\"x\")"])
def test_excel_formula_injection_is_text(value):
    c=Workbook().active.cell(1,1);safe_cell(c,value)
    assert c.data_type=="s" and c.value==value

@pytest.mark.parametrize("name",["../escape","/absolute","a/../../escape","a\\..\\escape"])
def test_zip_traversal_rejected(tmp_path,name):
    p=tmp_path/"bad.zip"
    with ZipFile(p,"w") as z:z.writestr(name,"bad");z.writestr("manifest.json",json.dumps({"schema_version":"2.0","files":{}}))
    with pytest.raises(ValueError):verify_archive(p)

