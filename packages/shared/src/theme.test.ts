import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME, googleFontUrl, parseTheme, themeSchema, themeToCss } from './theme.js';

describe('themeSchema', () => {
  it('aceita o tema padrão', () => {
    expect(themeSchema.safeParse(DEFAULT_THEME).success).toBe(true);
  });

  it('recusa valores que poderiam injetar CSS', () => {
    const bad = {
      ...DEFAULT_THEME,
      colors: { ...DEFAULT_THEME.colors, brand: 'red;}body{display:none' },
    };
    expect(themeSchema.safeParse(bad).success).toBe(false);
    const badFont = {
      ...DEFAULT_THEME,
      font: { source: 'google', family: 'Inter"}', uploadId: null },
    };
    expect(themeSchema.safeParse(badFont).success).toBe(false);
  });

  it('recusa links com javascript:', () => {
    const bad = { ...DEFAULT_THEME, links: [{ label: 'x', url: 'javascript:alert(1)' }] };
    expect(themeSchema.safeParse(bad).success).toBe(false);
  });

  it('parseTheme completa campos ausentes e cai no padrão se inválido', () => {
    expect(parseTheme({ mode: 'dark' }).mode).toBe('dark');
    expect(parseTheme({ mode: 'neon' })).toEqual(DEFAULT_THEME);
    expect(parseTheme(null)).toEqual(DEFAULT_THEME);
  });
});

describe('themeToCss', () => {
  it('gera variáveis claras e o bloco escuro no modo automático', () => {
    const css = themeToCss(DEFAULT_THEME);
    expect(css).toContain('--color-brand:#1f6feb');
    expect(css).toContain('--color-status-major_outage:#cf222e');
    expect(css).toMatch(/@media \(prefers-color-scheme:dark\)\{\.sp-theme\{--color-brand:#2f81f7/);
  });

  it('modo escuro fixo usa só a paleta escura', () => {
    const css = themeToCss({ ...DEFAULT_THEME, mode: 'dark' });
    expect(css).not.toContain('@media');
    expect(css).toContain('--background:#0d1117');
  });

  it('fonte enviada gera @font-face; Google gera URL', () => {
    const upload = themeToCss({
      ...DEFAULT_THEME,
      font: {
        source: 'upload',
        family: 'Minha Fonte',
        uploadId: '01a13300-0000-7000-8000-000000000000',
      },
    });
    expect(upload).toContain('@font-face{font-family:"Minha Fonte";src:url("/api/public/uploads/');
    expect(
      googleFontUrl({
        ...DEFAULT_THEME,
        font: { source: 'google', family: 'Open Sans', uploadId: null },
      }),
    ).toBe('https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;500;600;700&display=swap');
  });
});
