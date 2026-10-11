import { type ComponentStatus, isLocale, overallStatus } from '@status-page/shared';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LanguageSwitcher } from './language-switcher';

// Classes completas (e não interpoladas) para o Tailwind detectá-las no build.
const BANNER_CLASS: Record<ComponentStatus, string> = {
  operational: 'bg-status-operational',
  under_maintenance: 'bg-status-under_maintenance',
  degraded_performance: 'bg-status-degraded_performance',
  partial_outage: 'bg-status-partial_outage',
  major_outage: 'bg-status-major_outage',
};

/**
 * Página pública provisória (F0). Na F1 ela passa a ler páginas, componentes e
 * incidentes da API.
 */
export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations();
  const status = overallStatus([]);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-12">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{t('common.appName')}</h1>
        <LanguageSwitcher />
      </header>

      <section
        data-status={status}
        className={`rounded-lg px-6 py-4 text-lg font-medium text-white ${BANNER_CLASS[status]}`}
      >
        {t(`overall.${status}`)}
      </section>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
        <h2 className="border-b border-[var(--border)] px-6 py-3 font-medium">
          {t('home.components')}
        </h2>
        <p className="px-6 py-4 text-[var(--muted)]">{t('home.noComponents')}</p>
      </section>

      <footer className="text-center text-sm text-[var(--muted)]">{t('common.poweredBy')}</footer>
    </main>
  );
}
