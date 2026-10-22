import postcss, { type AtRule, type Declaration } from 'postcss';
import { Marked } from 'marked';
import sanitizeHtmlLib from 'sanitize-html';

/**
 * Sanitização do CSS e do HTML personalizados de uma página. Roda no servidor
 * ao salvar o tema; o resultado é gravado e exibido como está.
 */

export class InvalidCssError extends Error {
  constructor(readonly reason: string) {
    super(`CSS inválido: ${reason}`);
  }
}

const ALLOWED_AT_RULES = new Set([
  'media',
  'supports',
  'keyframes',
  '-webkit-keyframes',
  'font-face',
  'container',
  'layer',
]);

/** Únicos endereços permitidos: arquivos enviados para a própria instalação. */
const UPLOAD_PATH = /^\/api\/public\/uploads\/[0-9a-f-]{36}$/i;
const DANGEROUS_VALUE = /expression\s*\(|javascript:|vbscript:|-moz-binding|behavior\s*:/i;
const LOADS_RESOURCE = /\b(?:url|image-set|-webkit-image-set|src|cross-fade|image)\s*\(/i;

function referencedUrls(value: string): string[] {
  const urls: string[] = [];
  for (const m of value.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)) urls.push(m[2]!.trim());
  for (const m of value.matchAll(/(['"])(.*?)\1/g)) urls.push(m[2]!.trim());
  return urls;
}

export interface SanitizedCss {
  css: string;
  /** Regras e declarações removidas, para avisar quem editou. */
  removed: string[];
}

export function sanitizeCss(input: string): SanitizedCss {
  if (!input.trim()) return { css: '', removed: [] };
  let root;
  try {
    root = postcss.parse(input);
  } catch (error) {
    throw new InvalidCssError(
      error instanceof Error ? error.message.split('\n')[0]! : 'erro de sintaxe',
    );
  }
  const removed: string[] = [];

  root.walkAtRules((rule: AtRule) => {
    if (!ALLOWED_AT_RULES.has(rule.name.toLowerCase())) {
      removed.push(`@${rule.name} ${rule.params}`.trim());
      rule.remove();
    }
  });

  root.walkDecls((decl: Declaration) => {
    const text = `${decl.prop}:${decl.value}`;
    let unsafe = DANGEROUS_VALUE.test(text);
    if (!unsafe && LOADS_RESOURCE.test(decl.value)) {
      unsafe = referencedUrls(decl.value).some((url) => !UPLOAD_PATH.test(url));
    }
    if (unsafe) {
      removed.push(text.slice(0, 120));
      decl.remove();
    }
  });

  // `<` nunca é necessário fora de strings; escapado, impede fechar a tag <style>.
  const css = root.toString().replace(/</g, '\\3c ');
  return { css, removed };
}

const HTML_OPTIONS: sanitizeHtmlLib.IOptions = {
  allowedTags: [
    'a',
    'p',
    'div',
    'span',
    'strong',
    'em',
    'b',
    'i',
    'u',
    'small',
    'br',
    'hr',
    'ul',
    'ol',
    'li',
    'h1',
    'h2',
    'h3',
    'h4',
    'img',
    'nav',
    'section',
    'header',
    'footer',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'width', 'height'],
    '*': ['class', 'aria-label', 'role'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['https'] },
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: attribs.target === '_blank' ? { ...attribs, rel: 'noopener noreferrer' } : attribs,
    }),
  },
};

/** HTML de cabeçalho/rodapé: sem scripts, estilos inline, eventos ou iframes. */
export function sanitizeHtml(input: string): string {
  return sanitizeHtmlLib(input, HTML_OPTIONS).trim();
}

const MARKDOWN_OPTIONS: sanitizeHtmlLib.IOptions = {
  allowedTags: [
    'a',
    'p',
    'strong',
    'em',
    'del',
    'br',
    'hr',
    'ul',
    'ol',
    'li',
    'h1',
    'h2',
    'h3',
    'h4',
    'blockquote',
    'code',
    'pre',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'rel', 'target'],
    ol: ['start'],
    th: ['align'],
    td: ['align'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: { ...attribs, rel: 'noopener noreferrer nofollow', target: '_blank' },
    }),
  },
};
const markdown = new Marked({ gfm: true, breaks: true, async: false });

/** Markdown (postmortem) para HTML seguro: sem HTML bruto, imagens ou scripts. */
export function renderMarkdown(input: string): string {
  return sanitizeHtmlLib(markdown.parse(input) as string, MARKDOWN_OPTIONS).trim();
}
