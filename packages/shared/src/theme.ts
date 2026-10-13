import { z } from 'zod';
import { COMPONENT_STATUSES, type ComponentStatus } from './status.js';

/**
 * Identidade visual de uma página. Cores e nomes de fonte são validados com
 * padrões estritos porque entram direto no CSS gerado; CSS e HTML livres são
 * sanitizados no servidor antes de serem gravados.
 */

const hex = z
  .string()
  .trim()
  .regex(/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i, 'cor inválida (use #rgb ou #rrggbb)');

export const paletteSchema = z.object({
  brand: hex,
  background: hex,
  surface: hex,
  text: hex,
  muted: hex,
  border: hex,
  link: hex,
});
export type Palette = z.infer<typeof paletteSchema>;

const statusColorsSchema = z.object(
  Object.fromEntries(COMPONENT_STATUSES.map((s) => [s, hex])) as Record<
    ComponentStatus,
    typeof hex
  >,
);

const safeUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => /^(https?:\/\/|mailto:)/i.test(v), 'use um endereço http(s):// ou mailto:');

export const THEME_MODES = ['light', 'dark', 'auto'] as const;
export const HEADER_STYLES = ['simple', 'centered', 'banner'] as const;
export const FONT_SOURCES = ['system', 'google', 'upload'] as const;

export const CUSTOM_CSS_MAX = 50_000;
export const CUSTOM_HTML_MAX = 20_000;

export const themeSchema = z.object({
  mode: z.enum(THEME_MODES),
  colors: paletteSchema,
  darkColors: paletteSchema,
  statusColors: statusColorsSchema,
  font: z.object({
    source: z.enum(FONT_SOURCES),
    /** Nome da família (Google Fonts ou nome exibido da fonte enviada). */
    family: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9][A-Za-z0-9 -]{0,59}$/, 'nome de fonte inválido')
      .nullable(),
    uploadId: z.uuid().nullable(),
  }),
  logoId: z.uuid().nullable(),
  logoDarkId: z.uuid().nullable(),
  faviconId: z.uuid().nullable(),
  headerImageId: z.uuid().nullable(),
  ogImageId: z.uuid().nullable(),
  header: z.enum(HEADER_STYLES),
  showPastIncidents: z.boolean(),
  texts: z.object({
    footer: z.string().trim().max(300).nullable(),
    supportUrl: safeUrl.nullable(),
    supportLabel: z.string().trim().max(60).nullable(),
  }),
  links: z.array(z.object({ label: z.string().trim().min(1).max(60), url: safeUrl })).max(8),
  customCss: z.string().max(CUSTOM_CSS_MAX),
  customHeaderHtml: z.string().max(CUSTOM_HTML_MAX),
  customFooterHtml: z.string().max(CUSTOM_HTML_MAX),
});
export type Theme = z.infer<typeof themeSchema>;

export const DEFAULT_THEME: Theme = {
  mode: 'auto',
  colors: {
    brand: '#1f6feb',
    background: '#f6f8fa',
    surface: '#ffffff',
    text: '#1f2328',
    muted: '#59636e',
    border: '#d1d9e0',
    link: '#0969da',
  },
  darkColors: {
    brand: '#2f81f7',
    background: '#0d1117',
    surface: '#151b23',
    text: '#f0f6fc',
    muted: '#9198a1',
    border: '#3d444d',
    link: '#4493f8',
  },
  statusColors: {
    operational: '#1a7f37',
    under_maintenance: '#0969da',
    degraded_performance: '#bf8700',
    partial_outage: '#d4610b',
    major_outage: '#cf222e',
  },
  font: { source: 'system', family: null, uploadId: null },
  logoId: null,
  logoDarkId: null,
  faviconId: null,
  headerImageId: null,
  ogImageId: null,
  header: 'simple',
  showPastIncidents: true,
  texts: { footer: null, supportUrl: null, supportLabel: null },
  links: [],
  customCss: '',
  customHeaderHtml: '',
  customFooterHtml: '',
};

/** Lê um tema salvo, completando campos ausentes (temas gravados por versões antigas). */
export function parseTheme(value: unknown): Theme {
  const merged = { ...DEFAULT_THEME, ...(typeof value === 'object' && value ? value : {}) };
  const result = themeSchema.safeParse(merged);
  return result.success ? result.data : DEFAULT_THEME;
}

export const uploadUrl = (id: string) => `/api/public/uploads/${id}`;

const FONT_STACK =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

function paletteVars(p: Palette): string {
  return [
    `--color-brand:${p.brand}`,
    `--background:${p.background}`,
    `--surface:${p.surface}`,
    `--foreground:${p.text}`,
    `--muted:${p.muted}`,
    `--border:${p.border}`,
    `--link:${p.link}`,
  ].join(';');
}

/** Família CSS efetiva do tema (já entre aspas). */
export function themeFontFamily(theme: Theme): string {
  if (theme.font.source === 'system' || !theme.font.family) return FONT_STACK;
  return `"${theme.font.family}", ${FONT_STACK}`;
}

/** URL do Google Fonts para a família do tema, se houver. */
export function googleFontUrl(theme: Theme): string | null {
  if (theme.font.source !== 'google' || !theme.font.family) return null;
  const family = encodeURIComponent(theme.font.family).replace(/%20/g, '+');
  return `https://fonts.googleapis.com/css2?family=${family}:wght@400;500;600;700&display=swap`;
}

/**
 * CSS das variáveis do tema, aplicado ao seletor `scope`. Todos os valores
 * interpolados passaram pelo `themeSchema` (cores hex, nomes de fonte restritos).
 */
export function themeToCss(theme: Theme, scope = '.sp-theme'): string {
  const status = COMPONENT_STATUSES.map((s) => `--color-status-${s}:${theme.statusColors[s]}`).join(
    ';',
  );
  const base = `${paletteVars(theme.colors)};${status};font-family:${themeFontFamily(theme)}`;
  const dark = paletteVars(theme.darkColors);
  const rules: string[] = [];

  if (theme.font.source === 'upload' && theme.font.uploadId && theme.font.family) {
    rules.push(
      `@font-face{font-family:"${theme.font.family}";src:url("${uploadUrl(theme.font.uploadId)}");font-display:swap}`,
    );
  }
  if (theme.mode === 'dark') {
    rules.push(`${scope}{${base};${dark};color-scheme:dark}`);
  } else {
    rules.push(`${scope}{${base};color-scheme:light}`);
    if (theme.mode === 'auto') {
      rules.push(`@media (prefers-color-scheme:dark){${scope}{${dark};color-scheme:dark}}`);
    }
  }
  return rules.join('\n');
}
