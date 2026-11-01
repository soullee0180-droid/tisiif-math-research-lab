import {
  PDFDocument,
  PDFName,
  PDFDict,
  PDFArray,
  PDFRawStream,
  decodePDFRawStream,
} from "pdf-lib";
// Accept only our raster-PDF subset. This is structural validation, not semantic leakage review.
export async function inspectPrepared(bytes: Uint8Array) {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  if (pdf.isEncrypted || pdf.getPageCount() < 1 || pdf.getPageCount() > 30)
    throw Error("PDF_PAGE_LIMIT");
  const forbidden = new Set([
    "Font",
    "Annots",
    "Names",
    "AcroForm",
    "JavaScript",
    "JS",
    "OpenAction",
    "AA",
    "EmbeddedFiles",
    "EmbeddedFile",
    "Filespec",
    "Metadata",
    "XFA",
    "OCProperties",
    "ActualText",
    "Alt",
  ]);
  let count = 0;
  const inspect = (value: any, depth = 0) => {
    if (depth > 30 || ++count > 200000) throw Error("PDF_STRUCTURE_LIMIT");
    if (value instanceof PDFDict) {
      for (const [key, v] of value.entries()) {
        if (forbidden.has(key.decodeText())) {
          const resolved = pdf.context.lookup(v);
          if (
            !(
              (key.decodeText() === "Font" &&
                resolved instanceof PDFDict &&
                resolved.keys().length === 0) ||
              (key.decodeText() === "Annots" &&
                resolved instanceof PDFArray &&
                resolved.asArray().length === 0)
            )
          )
            throw Error("PDF_HIDDEN_CONTENT_" + key.decodeText());
        }
        inspect(v, depth + 1);
      }
    } else if (value instanceof PDFArray)
      for (const v of value.asArray()) inspect(v, depth + 1);
    else if (value instanceof PDFRawStream) inspect(value.dict, depth + 1);
  };
  for (const [, obj] of pdf.context.enumerateIndirectObjects()) inspect(obj);
  for (const page of pdf.getPages()) {
    const contents = page.node.Contents();
    const streams =
      contents instanceof PDFArray
        ? contents.asArray()
        : contents
          ? [contents]
          : [];
    if (!streams.length) throw Error("PDF_EMPTY_PAGE");
    for (const ref of streams) {
      const stream = pdf.context.lookup(ref);
      if (!(stream instanceof PDFRawStream)) throw Error("PDF_CONTENT_STREAM");
      const decoded = decodePDFRawStream(stream).decode();
      if (decoded.length > 100000) throw Error("PDF_CONTENT_LIMIT");
      const text = new TextDecoder("latin1").decode(decoded);
      // Generated pages contain only graphics transforms and image draw operations.
      if (
        text.replace(
          /\/[A-Za-z0-9_-]+|[-+]?(?:\d*\.\d+|\d+)|\b(?:q|Q|cm|Do)\b|\s+/g,
          "",
        ).length
      )
        throw Error("PDF_NON_IMAGE_CONTENT");
    }
    const resources = page.node.Resources();
    const xobjects = resources?.lookup(PDFName.of("XObject"));
    if (!(xobjects instanceof PDFDict)) throw Error("PDF_IMAGE_REQUIRED");
    for (const [, ref] of xobjects.entries()) {
      const image = pdf.context.lookup(ref);
      if (
        !(image instanceof PDFRawStream) ||
        image.dict.get(PDFName.of("Subtype"))?.toString() !== "/Image"
      )
        throw Error("PDF_NON_IMAGE_XOBJECT");
    }
  }
  return {
    status: "PASS",
    pages: pdf.getPageCount(),
    parser: "pdf-lib-image-subset-v1",
    scope: "server image-only structure; human semantic review still required",
  };
}
