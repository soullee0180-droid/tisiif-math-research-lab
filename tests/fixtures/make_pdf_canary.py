from reportlab.pdfgen import canvas
from pypdf import PdfReader,PdfWriter
from pypdf.annotations import Text
import io,pathlib
buffer=io.BytesIO();c=canvas.Canvas(buffer,pagesize=(300,300));c.setTitle('PRIVATE_TITLE_CANARY');c.drawString(20,250,'PUBLIC FIXTURE');c.drawString(20,70,'SECRET_CANARY');c.save();writer=PdfWriter();writer.append(PdfReader(buffer));writer.add_js("app.alert('JS_CANARY')");writer.add_attachment('secret.txt',b'ATTACHMENT_CANARY');writer.add_annotation(0,Text(rect=(20,20,70,70),text='ANNOTATION_CANARY'));writer.add_metadata({'/Author':'PRIVATE_AUTHOR_CANARY'});writer.write('tests/fixtures/pdf-canary.pdf')
