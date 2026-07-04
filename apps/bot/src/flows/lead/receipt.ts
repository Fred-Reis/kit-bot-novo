export function buildReceiptMessage(count: number): string | null {
  if (count <= 0) return null;
  if (count === 1) return '📄 Recebi seu documento!';
  return `📄 Recebi ${count} documentos!`;
}
