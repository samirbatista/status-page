import { describe, expect, it } from 'vitest';
import { InvalidCssError, sanitizeCss, sanitizeHtml } from './sanitize.js';

const UPLOAD = '/api/public/uploads/01a13300-0000-7000-8000-000000000000';

describe('sanitizeCss', () => {
  it('mantém CSS comum', () => {
    const { css, removed } = sanitizeCss('.x{color:red}@media (max-width:600px){.y{display:none}}');
    expect(css).toContain('.x{color:red}');
    expect(css).toContain('@media');
    expect(removed).toEqual([]);
  });

  it('remove @import, url() externo, expression e javascript:', () => {
    const { css, removed } = sanitizeCss(`
      @import url("https://evil.example/x.css");
      .a { background: url(https://evil.example/track.png); color: blue }
      .b { width: expression(alert(1)) }
      .c { background-image: image-set("https://evil.example/a.png" 1x) }
      .d { background: url('${UPLOAD}') }
    `);
    expect(css).not.toMatch(/evil|expression|@import/);
    expect(css).toContain('color: blue');
    expect(css).toContain(UPLOAD);
    expect(removed).toHaveLength(4);
  });

  it('não permite fechar a tag <style>', () => {
    const { css } = sanitizeCss('.a::after{content:"</style><script>alert(1)</script>"}');
    expect(css).not.toContain('<');
  });

  it('rejeita CSS com erro de sintaxe', () => {
    expect(() => sanitizeCss('.a{color:red')).toThrow(InvalidCssError);
  });
});

describe('sanitizeHtml', () => {
  it('remove scripts, eventos, estilos e iframes', () => {
    const html = sanitizeHtml(
      '<p onclick="x()" style="color:red">Oi<script>alert(1)</script></p><iframe src="https://x"></iframe><a href="javascript:alert(1)">x</a>',
    );
    expect(html).toBe('<p>Oi</p><a>x</a>');
  });

  it('mantém links seguros e força rel em target=_blank', () => {
    const html = sanitizeHtml('<a href="https://acme.com" target="_blank">Acme</a>');
    expect(html).toBe(
      '<a href="https://acme.com" target="_blank" rel="noopener noreferrer">Acme</a>',
    );
  });

  it('imagens só por https ou caminho relativo', () => {
    expect(sanitizeHtml('<img src="http://x/a.png">')).toBe('<img />');
    expect(sanitizeHtml(`<img src="${UPLOAD}" alt="logo">`)).toBe(
      `<img src="${UPLOAD}" alt="logo" />`,
    );
  });
});
