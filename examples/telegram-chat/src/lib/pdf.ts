/**
 * Generate a minimal valid PDF in memory. No binary-processing dependency.
 *
 * Builds a one-page PDF with a single line of text, using hand-written
 * PDF 1.4 object syntax. Cross-reference table offsets are computed from
 * object string lengths so the output is byte-for-byte valid.
 */

export function generateMinimalPdf(text: string): Buffer {
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] " +
      "/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n",
    `4 0 obj\n<< /Length ${
      `BT /F1 18 Tf 72 720 Td (${escapePdfText(text)}) Tj ET`.length
    } >>\nstream\nBT /F1 18 Tf 72 720 Td (${escapePdfText(text)}) Tj ET\nendstream\nendobj\n`,
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
  ];

  const header = "%PDF-1.4\n";
  const offsets: number[] = [];
  let body = header;
  for (const obj of objects) {
    offsets.push(body.length);
    body += obj;
  }

  const xrefOffset = body.length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    xref += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  }

  const trailer =
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(body + xref + trailer, "binary");
}

function escapePdfText(text: string): string {
  return text.replace(/[\\()]/g, "\\$&");
}
