/** Converte um instante para o valor de um `<input type="datetime-local">` (fuso do navegador). */
export function toLocalInput(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Interpreta o valor de um `datetime-local` no fuso do navegador e devolve ISO (UTC). */
export function fromLocalInput(value: string): string {
  return new Date(value).toISOString();
}
