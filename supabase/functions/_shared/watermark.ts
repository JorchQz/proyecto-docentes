// Aplica un pie de página identificador con los datos del comprador.
//
// PDF  → pie de página en CADA hoja (no se puede borrar sin software especial).
// DOCX → inyecta el texto en los footers existentes y, como respaldo, un
//        párrafo al final del documento. El comprador PUEDE borrarlo (por eso
//        la versión editable cuesta más): es un disuasivo, no un candado.

import { PDFDocument, rgb, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";
// Las variantes SÍNCRONAS a propósito: `unzip`/`zip` (asíncronas) arrancan un
// Web Worker y el runtime de las Edge Functions no los admite —fallaban con
// "Classic workers are not supported"—, así que el pie del DOCX nunca llegó a
// aplicarse y el archivo salía sin el nombre del comprador.
import { unzipSync, zipSync, strToU8, strFromU8 } from "https://esm.sh/fflate@0.8.2";

// Decía "Uso docente exclusivo", que restringe el TIPO de uso (docente y no
// comercial) cuando lo que hay que restringir es la PERSONA. "Personal e
// intransferible" es la fórmula habitual para eso y no choca con enseñarle la
// planeación al director, que es parte del trabajo: por eso también se cambió
// "distribución" —demasiado amplia— por la reventa y el reparto entre colegas.
export function textoPie(nombre: string, cct?: string | null): string {
  const id = cct ? `${nombre} · CCT ${cct}` : nombre;
  return `Creado por Jissez para ${id} · Uso personal e intransferible · Prohibida su reventa`;
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

  // Altura del texto sobre el borde inferior, en puntos (1 pt = 0,353 mm).
  //
  // Empezó en 5 pt = 1,76 mm, dentro del margen que NO imprime ninguna
  // impresora doméstica: el pie desaparecía justo al imprimir, que es por
  // donde más se redistribuye el material.
  //
  // 24 pt = 8,5 mm. Las láser recortan unos 5 mm y las de inyección hasta 12,
  // y el margen inferior es el mayor de los cuatro por el arrastre del papel.
  // No se sube más porque el número de página del documento está alrededor de
  // los 38 pt y hay que dejarle aire.
  const BASE_TEXTO = 24;
  const BANDA_DESDE = 12;
  const BANDA_ALTO = 22;

  for (const page of pages) {
    const { width } = page.getSize();
    const textWidth = font.widthOfTextAtSize(texto, size);
    const x = Math.max((width - textWidth) / 2, 10);
    // Banda blanca semitransparente para legibilidad + texto gris.
    page.drawRectangle({
      x: 0,
      y: BANDA_DESDE,
      width,
      height: BANDA_ALTO,
      color: rgb(1, 1, 1),
      opacity: 0.7,
    });
    page.drawText(texto, {
      x,
      y: BASE_TEXTO,
      size,
      font,
      color: rgb(0.45, 0.45, 0.45),
    });
  }

  return await pdfDoc.save();
}

// ── DOCX ────────────────────────────────────────────────────────────────────

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

export function aplicarPieDocx(bytes: Uint8Array, texto: string): Uint8Array {
  const files = unzipSync(bytes);
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

  // 2. Respaldo: si no había footers, un párrafo al final del cuerpo. Va antes
  //    del <w:sectPr> final, que debe ser el último hijo de <w:body>: colgarlo
  //    después deja el OOXML inválido y Word pide reparar el archivo.
  if (!inyectado && files["word/document.xml"]) {
    let xml = strFromU8(files["word/document.xml"]);
    const fin = xml.lastIndexOf("</w:body>");
    if (fin !== -1) {
      const sect = xml.lastIndexOf("<w:sectPr");
      const idx = sect !== -1 && sect < fin ? sect : fin;
      xml = xml.slice(0, idx) + parrafo + xml.slice(idx);
      files["word/document.xml"] = strToU8(xml);
    }
  }

  return zipSync(files);
}
