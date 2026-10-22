import { notFound } from 'next/navigation';
import { ConfigTransfer } from '@/components/admin/config-transfer';
import { getMe } from '@/lib/admin';

export default async function TransferPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const me = await getMe(locale);
  if (!me.isOwner) notFound();
  return <ConfigTransfer pages={me.pages.map((p) => ({ id: p.id, name: p.name }))} />;
}
