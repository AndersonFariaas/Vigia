/** Data curta em pt-BR. Sem data, a página ainda não foi checada. */
export function formatDate(iso) {
  if (!iso) return 'nunca';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}
