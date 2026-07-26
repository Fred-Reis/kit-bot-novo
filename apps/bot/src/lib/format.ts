export function formatBRL(n: number | { toString(): string }): string {
  return Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
