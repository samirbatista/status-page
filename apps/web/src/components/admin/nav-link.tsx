'use client';

import { Link, usePathname } from '@/i18n/navigation';
import { cx } from '../ui/ui';

/** Link de navegação que destaca a seção atual. */
export function NavLink({
  href,
  exact = false,
  children,
}: {
  href: string;
  exact?: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cx(
        'rounded-md px-3 py-2 text-sm',
        active
          ? 'bg-[var(--background)] font-medium'
          : 'text-[var(--muted)] hover:bg-[var(--background)]',
      )}
    >
      {children}
    </Link>
  );
}
