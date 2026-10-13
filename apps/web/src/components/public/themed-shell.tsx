import { googleFontUrl, themeToCss, uploadUrl, type Theme } from '@status-page/shared';
import { useTranslations } from 'next-intl';
import { type ReactNode } from 'react';
import { Link } from '@/i18n/navigation';
import { type PublicPage } from '@/lib/types';
import { LanguageSwitcher } from '../language-switcher';
import { cx } from '../ui/ui';
import { ThemePreviewBridge } from './theme-preview-bridge';

/** Logo da página, com a versão escura quando o tema muda com o sistema. */
function Logo({ theme, name }: { theme: Theme; name: string }) {
  const light = theme.logoId ? uploadUrl(theme.logoId) : null;
  const dark = theme.logoDarkId ? uploadUrl(theme.logoDarkId) : null;
  if (!light && !dark) return null;
  const main = theme.mode === 'dark' ? (dark ?? light)! : (light ?? dark)!;
  return (
    <picture>
      {theme.mode === 'auto' && dark && light ? (
        <source srcSet={dark} media="(prefers-color-scheme: dark)" />
      ) : null}
      <img src={main} alt={name} className="h-10 w-auto max-w-[16rem] object-contain" />
    </picture>
  );
}

/**
 * Moldura da página pública com a identidade visual da página: variáveis de
 * cor, fonte, logo, estilo de cabeçalho, textos, links e CSS/HTML
 * personalizados (sanitizados no servidor ao salvar o tema).
 */
export function ThemedShell({ page, children }: { page: PublicPage; children: ReactNode }) {
  const t = useTranslations('common');
  const { theme } = page;
  const fontUrl = googleFontUrl(theme);
  const headerImage = theme.headerImageId ? uploadUrl(theme.headerImageId) : null;
  const banner = theme.header === 'banner' && headerImage;
  const centered = theme.header === 'centered';

  const title = (
    <div className={cx('flex flex-col gap-1', centered && 'items-center text-center')}>
      <Link
        href={`/p/${page.slug}`}
        className={cx(
          'flex items-center gap-3 text-2xl font-semibold hover:underline',
          banner && 'text-white',
        )}
      >
        <Logo theme={theme} name={page.name} />
        <span className={cx(theme.logoId || theme.logoDarkId ? 'sr-only' : undefined)}>
          {page.name}
        </span>
      </Link>
      {page.description ? (
        <p className={cx('text-sm', banner ? 'text-white/90' : 'text-[var(--muted)]')}>
          {page.description}
        </p>
      ) : null}
    </div>
  );

  return (
    <div className="sp-theme min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      {fontUrl ? <link rel="stylesheet" href={fontUrl} /> : null}
      <style dangerouslySetInnerHTML={{ __html: `${themeToCss(theme)}\n${theme.customCss}` }} />
      {page.preview ? <ThemePreviewBridge /> : null}

      {banner ? (
        <div
          className="bg-cover bg-center"
          style={{
            backgroundImage: `linear-gradient(rgba(0,0,0,.45),rgba(0,0,0,.45)),url("${headerImage}")`,
          }}
        >
          <header className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-4 px-4 py-12">
            {title}
            <LanguageSwitcher />
          </header>
        </div>
      ) : null}

      <main className="mx-auto flex max-w-4xl flex-col gap-8 px-4 py-10">
        {!banner ? (
          <header
            className={cx(
              'flex flex-wrap items-center gap-4',
              centered ? 'flex-col justify-center' : 'justify-between',
            )}
          >
            {title}
            <LanguageSwitcher />
          </header>
        ) : null}
        {theme.customHeaderHtml ? (
          <div
            className="sp-custom-header"
            dangerouslySetInnerHTML={{ __html: theme.customHeaderHtml }}
          />
        ) : null}

        {children}

        <footer className="flex flex-col gap-3 border-t border-[var(--border)] pt-6 text-sm text-[var(--muted)]">
          {theme.customFooterHtml ? (
            <div
              className="sp-custom-footer"
              dangerouslySetInnerHTML={{ __html: theme.customFooterHtml }}
            />
          ) : null}
          {theme.links.length > 0 || theme.texts.supportUrl ? (
            <nav className="flex flex-wrap gap-4">
              {theme.links.map((link) => (
                <a
                  key={`${link.label}-${link.url}`}
                  href={link.url}
                  className="text-[var(--link)] hover:underline"
                  rel="noopener noreferrer"
                >
                  {link.label}
                </a>
              ))}
              {theme.texts.supportUrl ? (
                <a
                  href={theme.texts.supportUrl}
                  className="text-[var(--link)] hover:underline"
                  rel="noopener noreferrer"
                >
                  {theme.texts.supportLabel || t('support')}
                </a>
              ) : null}
            </nav>
          ) : null}
          {theme.texts.footer ? <p className="whitespace-pre-line">{theme.texts.footer}</p> : null}
          <div className="flex flex-wrap justify-between gap-2">
            <Link href={`/p/${page.slug}/history`} className="hover:underline">
              {t('history')}
            </Link>
            <span>{t('poweredBy')}</span>
          </div>
        </footer>
      </main>
    </div>
  );
}
