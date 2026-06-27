// Two-pass: label-first avoids false positives from other 11-digit fields (e.g. CNH REGISTRO)
const CPF_LABEL_REGEX = /\bCPF[:\s.]*(\d{3}\.?\d{3}\.?\d{3}-?\d{2})/i;
const CPF_BARE_REGEX = /\d{3}\.?\d{3}\.?\d{3}-?\d{2}/;

function normalizeCpf(raw: string): string {
  return raw.replace(/\D/g, '').replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
}

export function extractCpfFromDocs(docs: { ocrText: string | null }[]): string | null {
  for (const d of docs) {
    const match = CPF_LABEL_REGEX.exec(d.ocrText ?? '');
    if (match) return normalizeCpf(match[1]);
  }
  for (const d of docs) {
    const match = CPF_BARE_REGEX.exec(d.ocrText ?? '');
    if (match) return normalizeCpf(match[0]);
  }
  return null;
}
