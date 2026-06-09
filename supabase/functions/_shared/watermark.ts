// Aplica un pie de página identificador con los datos del comprador.
//
// PDF  → pie de página en CADA hoja (no se puede borrar sin software especial).
// DOCX → inyecta el texto en los footers existentes y, como respaldo, un
//        párrafo al final del documento. El comprador PUEDE borrarlo (por eso
//        la versión editable cuesta más): es un disuasivo, no un candado.

import { PDFDocument, rgb, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";
import { unzip, zip, strToU8, strFromU8 } from "https://esm.sh/fflate@0.8.2";

export function textoPie(nombre: string, email: string): string {
  return `Creado por Jissez para ${nombre} (${email}) · Uso docente exclusivo · Prohibida su distribución o reventa`;
}

// ── PDF ─────────────────────────────────────────────────────────────────────
export async function aplicarPiePdf(
  bytes: Uint8Array,
  texto: string,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const size = 8;
  const pages = pdfDoc.getPages();

  for (const page of pages) {
    const { width } = page.getSize();
    const textWidth = font.widthOfTextAtSize(texto, size);
    const x = Math.max((width - textWidth) / 2, 10);
    // Banda blanca semitransparente para legibilidad + texto gris.
    page.drawRectangle({
      x: 0,
      y: 0,
      width,
      height: 16,
      color: rgb(1, 1, 1),
      opacity: 0.7,
    });
    page.drawText(texto, {
      x,
      y: 5,
      size,
      font,
      color: rgb(0.45, 0.45, 0.45),
    });
  }

  return await pdfDoc.save();
}

// ── DOCX ────────────────────────────────────────────────────────────────────
function unzipAsync(bytes: Uint8Array): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    unzip(bytes, (err, data) => (err ? reject(err) : resolve(data)));
  });
}

function zipAsync(files: Record<string, Uint8Array>): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zip(files, (err, data) => (err ? reject(err) : resolve(data)));
  });
}

// Párrafo OOXML con el texto del pie (gris, pequeño, centrado).
function parrafoPie(texto: string): string {
  const safe = texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return (
    `<w:p><w:pPr><w:jc w:val="center"/></w:pPr>` +
    `<w:r><w:rPr><w:color w:val="808080"/><w:sz w:val="16"/></w:rPr>` +
    `<w:t xml:space="preserve">${safe}</w:t></w:r></w:p>`
  );
}

export async function aplicarPieDocx(
  bytes: Uint8Array,
  texto: string,
): Promise<Uint8Array> {
  const files = await unzipAsync(bytes);
  const parrafo = parrafoPie(texto);
  let inyectado = false;

  // 1. Inyectar en footers existentes (word/footer1.xml, footer2.xml, ...)
  for (const name of Object.keys(files)) {
    if (/^word\/footer\d*\.xml$/.test(name)) {
      let xml = strFromU8(files[name]);
      const idx = xml.lastIndexOf("</w:ftr>");
      if (idx !== -1) {
        xml = xml.slice(0, idx) + parrafo + xml.slice(idx);
        files[name] = strToU8(xml);
        inyectado = true;
      }
    }
  }

  // 2. Respaldo: si no había footers, agregar el párrafo al final del cuerpo.
  if (!inyectado && files["word/document.xml"]) {
    let xml = strFromU8(files["word/document.xml"]);
    const idx = xml.lastIndexOf("</w:body>");
    if (idx !== -1) {
      xml = xml.slice(0, idx) + parrafo + xml.slice(idx);
      files["word/document.xml"] = strToU8(xml);
    }
  }

  return await zipAsync(files);
}
