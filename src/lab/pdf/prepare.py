import io
import math
from PIL import ImageDraw
from pypdf import PdfReader
import pypdfium2 as pdfium
from reportlab.pdfgen import canvas

def inspect_pdf(data):
    if not data.startswith(b"%PDF-"): raise ValueError("NOT_A_PDF")
    reader = PdfReader(io.BytesIO(data))
    if reader.is_encrypted: raise ValueError("ENCRYPTED_PDF")
    if not len(reader.pages): raise ValueError("EMPTY_PDF")
    return len(reader.pages)

def validate_recipe(recipe, count):
    if not isinstance(recipe, list) or not any(p.get("include") for p in recipe):
        raise ValueError("INCLUDE_AT_LEAST_ONE_PAGE")
    seen = set()
    for p in recipe:
        if type(p.get("page")) is not int or not 1 <= p["page"] <= count or p["page"] in seen:
            raise ValueError("INVALID_PAGE")
        seen.add(p["page"])
        if p.get("rotation", 0) not in (0, 90, 180, 270): raise ValueError("INVALID_ROTATION")
        for m in p.get("masks", []):
            x, y, w, h = [m[k] for k in ("x", "y", "w", "h")]
            if not all(isinstance(t, (float, int)) and math.isfinite(t) for t in (x, y, w, h)):
                raise ValueError("INVALID_MASK")
            if not (0 <= x < 1 and 0 <= y < 1 and w > 0 and h > 0 and x+w <= 1 and y+h <= 1):
                raise ValueError("INVALID_MASK")

def page_image(data, page, rotation=0, dpi=100):
    with pdfium.PdfDocument(data) as doc:
        if not 1 <= page <= len(doc): raise ValueError("INVALID_PAGE")
        p = doc[page-1]
        bitmap = p.render(scale=dpi/72, rotation=rotation)
        try: return bitmap.to_pil().convert("RGB").copy()
        finally: bitmap.close(); p.close()

def sanitize(data, recipe):
    count = inspect_pdf(data)
    validate_recipe(recipe, count)
    target = io.BytesIO()
    out = canvas.Canvas(target)
    out.setTitle("Public research context")
    out.setAuthor("")
    for rec in recipe:
        if not rec.get("include"): continue
        img = page_image(data, rec["page"], rec.get("rotation", 0), 200)
        width, height = img.size
        draw = ImageDraw.Draw(img)
        for m in rec.get("masks", []):
            box = (max(0, math.floor(m["x"]*width)-2), max(0, math.floor(m["y"]*height)-2),
                   min(width, math.ceil((m["x"]+m["w"])*width)+2),
                   min(height, math.ceil((m["y"]+m["h"])*height)+2))
            draw.rectangle(box, fill="black")
        from reportlab.lib.utils import ImageReader
        w, h = width*72/200, height*72/200
        out.setPageSize((w,h))
        out.drawImage(ImageReader(img), 0, 0, width=w, height=h)
        out.showPage()
    out.save()
    result = target.getvalue()
    # No source text, annotations or attachment metadata is copied.
    if any((p.extract_text() or "").strip() for p in PdfReader(io.BytesIO(result)).pages):
        raise ValueError("SANITIZED_PDF_HAS_TEXT_LAYER")
    return result

def png(data, page, rotation=0):
    img = page_image(data, page, rotation)
    buf = io.BytesIO(); img.save(buf, format="PNG")
    return buf.getvalue()

