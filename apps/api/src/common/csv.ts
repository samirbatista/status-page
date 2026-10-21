/** CSV (RFC 4180) mínimo: aspas, vírgulas e quebras de linha dentro de campos. */

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return (
    rows
      .map((row) =>
        row
          .map((value) => {
            const text = value === null || value === undefined ? '' : String(value);
            // Evita injeção de fórmulas ao abrir no Excel/LibreOffice.
            const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
            return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
          })
          .join(','),
      )
      .join('\r\n') + '\r\n'
  );
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const input = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    if (quoted) {
      if (c === '"' && input[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',' || c === ';') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && input[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((v) => v.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  row.push(field);
  if (row.some((v) => v.trim() !== '')) rows.push(row);
  return rows.map((r) => r.map((v) => v.trim()));
}
