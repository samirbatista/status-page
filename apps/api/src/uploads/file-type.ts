/** Detecção do tipo real do arquivo pelos primeiros bytes (não confia na extensão). */

export interface DetectedType {
  kind: 'image' | 'font';
  contentType: string;
}

function startsWith(buf: Buffer, bytes: number[], offset = 0): boolean {
  return bytes.every((b, i) => buf[offset + i] === b);
}

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

export function detectFileType(buf: Buffer): DetectedType | null {
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { kind: 'image', contentType: 'image/png' };
  }
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return { kind: 'image', contentType: 'image/jpeg' };
  if (startsWith(buf, ascii('GIF87a')) || startsWith(buf, ascii('GIF89a'))) {
    return { kind: 'image', contentType: 'image/gif' };
  }
  if (startsWith(buf, ascii('RIFF')) && startsWith(buf, ascii('WEBP'), 8)) {
    return { kind: 'image', contentType: 'image/webp' };
  }
  if (startsWith(buf, [0x00, 0x00, 0x01, 0x00])) {
    return { kind: 'image', contentType: 'image/x-icon' };
  }
  if (startsWith(buf, ascii('wOF2'))) return { kind: 'font', contentType: 'font/woff2' };
  if (startsWith(buf, ascii('wOFF'))) return { kind: 'font', contentType: 'font/woff' };
  if (startsWith(buf, [0x00, 0x01, 0x00, 0x00]) || startsWith(buf, ascii('true'))) {
    return { kind: 'font', contentType: 'font/ttf' };
  }
  if (startsWith(buf, ascii('OTTO'))) return { kind: 'font', contentType: 'font/otf' };
  if (looksLikeSvg(buf)) return { kind: 'image', contentType: 'image/svg+xml' };
  return null;
}

function looksLikeSvg(buf: Buffer): boolean {
  const head = buf
    .subarray(0, 4096)
    .toString('utf8')
    .replace(/^\uFEFF/, '');
  // Declaração XML, comentários e DOCTYPE podem preceder a tag <svg>.
  const stripped = head.replace(
    /^\s*(<\?xml[^>]*>\s*|<!--[\s\S]*?-->\s*|<!DOCTYPE[^>]*>\s*)*/i,
    '',
  );
  return /^<svg[\s>]/i.test(stripped);
}

/**
 * SVG pode conter scripts. Além de servir uploads com CSP `sandbox`, recusamos
 * SVGs com scripts, eventos, conteúdo embutido ou referências externas.
 */
export function isUnsafeSvg(buf: Buffer): boolean {
  const text = buf.toString('utf8');
  return (
    /<script|<foreignObject|<iframe|<embed|<object|javascript:|@import/i.test(text) ||
    /\son[a-z]+\s*=/i.test(text) ||
    /\b(?:xlink:)?href\s*=\s*["']?\s*(?!#)/i.test(text) ||
    /url\(\s*["']?\s*(?!#)/i.test(text)
  );
}
