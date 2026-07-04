export type LeadDocumentType =
  | 'cnh_front'
  | 'cnh_back'
  | 'cnh_full'
  | 'rg_front'
  | 'rg_back'
  | 'cpf'
  | 'income_proof'
  | 'unknown';

export const DOC_TYPE_LABEL: Record<LeadDocumentType, string> = {
  cnh_front: 'frente da CNH',
  cnh_back: 'verso da CNH',
  cnh_full: 'CNH completa (foto única)',
  rg_front: 'frente do RG',
  rg_back: 'verso do RG',
  cpf: 'CPF',
  income_proof: 'comprovante de renda',
  unknown: 'documento não identificado',
};

const CPF_NUMBER = /\d{3}\.?\d{3}\.?\d{3}-?\d{2}/;

function norm(value: string): string {
  return value.toUpperCase().normalize('NFKD').replace(/\p{M}/gu, '');
}

export function classifyDocument(ocrText: string): LeadDocumentType {
  const t = norm(ocrText);
  if (!t.trim()) return 'unknown';

  const cnhHeader = t.includes('CARTEIRA NACIONAL DE HABILITACAO') || t.includes('PERMISSAO PARA DIRIGIR');
  const cnhFrontMarkers =
    t.includes('CAT. HAB') || t.includes('CAT HAB') || (t.includes('FILIACAO') && t.includes('VALIDADE'));
  const cnhBackMarkers = t.includes('OBSERVACOES') && (t.includes('LOCAL') || t.includes('EMISSAO'));

  if (cnhHeader && cnhBackMarkers) return 'cnh_full';
  if (cnhHeader || cnhFrontMarkers) return 'cnh_front';
  if (cnhBackMarkers) return 'cnh_back';

  const incomeMarkers =
    t.includes('DEMONSTRATIVO DE PAGAMENTO') ||
    t.includes('HOLERITE') ||
    t.includes('CONTRACHEQUE') ||
    t.includes('RECIBO DE PAGAMENTO') ||
    (t.includes('SALARIO') && t.includes('LIQUIDO')) ||
    t.includes('EXTRATO');
  if (incomeMarkers) return 'income_proof';

  const rgHeader =
    t.includes('REGISTRO GERAL') || t.includes('CARTEIRA DE IDENTIDADE') || t.includes('SEGURANCA PUBLICA');
  const rgDataMarkers = t.includes('FILIACAO') || t.includes('NATURALIDADE') || t.includes('EXPEDICAO');
  if (rgHeader || rgDataMarkers) {
    return rgDataMarkers ? 'rg_back' : 'rg_front';
  }

  const cpfMarkers =
    t.includes('CADASTRO DE PESSOAS FISICAS') ||
    t.includes('CADASTRO DE PESSOA FISICA') ||
    (t.includes('CPF') && CPF_NUMBER.test(t));
  if (cpfMarkers) return 'cpf';

  return 'unknown';
}
