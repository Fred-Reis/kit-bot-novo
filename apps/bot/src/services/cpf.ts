// Two-pass: label-first avoids false positives from other 11-digit fields (e.g. CNH REGISTRO)
const CPF_LABEL_REGEX = /\bCPF[:\s.]*(\d{3}\.?\d{3}\.?\d{3}-?\d{2})/i;
const CPF_BARE_REGEX = /\d{3}\.?\d{3}\.?\d{3}-?\d{2}/;

// RG: label-first only — bare digit sequences appear everywhere in docs.
// CNH OCR format: "DOC. IDENTIDADE/ORG. EMISSOR/UF-\n223715418DETRANRJ"
//   → label followed by arbitrary non-digit chars (slash, text, newline) before the digits.
// RG/carteira de identidade: simpler "RG: 123456789" format, [:\s]* suffices.
const RG_LABEL_REGEX =
  /(?:RG[:\s]*|REGISTRO\s*GERAL[:\s]*|DOC\.?\s*IDENTIDADE[^\d]{0,60})(\d{6,10})/i;

function extractDigits(raw: string): string {
  return raw.replace(/\D/g, '');
}

function normalizeCpf(raw: string): string {
  return extractDigits(raw).replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
}

export function maskCpf(cpf: string): string {
  return cpf.replace(/(\d{3})\.\d{3}\.\d{3}-\d{2}/, '$1.***.***-**');
}

export function isValidCpfFormat(raw: string): boolean {
  return extractDigits(raw).length === 11;
}

export function isValidCnpjFormat(raw: string): boolean {
  return extractDigits(raw).length === 14;
}

export function extractRgFromDocs(docs: { ocrText: string | null }[]): string | null {
  for (const d of docs) {
    const match = RG_LABEL_REGEX.exec(d.ocrText ?? '');
    if (match) return match[1].trim();
  }
  return null;
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
