/** Só aceita caminhos locais como destino depois do login (evita redirecionamento aberto). */
export function safeNextPath(next: string | null | undefined): string | null {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\')
    ? next
    : null;
}
