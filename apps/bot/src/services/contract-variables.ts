const TEMPLATE_VAR_RE = /\{\{([^}]+)\}\}/g;

export const formatDatePtBR = (d: Date): string =>
  d.toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

export function uniquePlaceholders(text: string): string[] {
  return [...new Set([...text.matchAll(TEMPLATE_VAR_RE)].map((m) => m[0]))];
}

export function buildLeadAutoMap(
  lead: { name: string | null; phone: string },
  property: {
    externalId: string;
    name: string;
    address: string;
    complement: string | null;
    neighborhood: string;
    rent: unknown;
    deposit: unknown;
    contractMonths: number | null;
    owner?: { name: string; cpf?: string | null; cnpj?: string | null; address?: string | null } | null;
  },
  paymentDayOfMonth: number,
  cpf: string | null,
  rg: string | null = null,
): Record<string, string> {
  const fmt = (n: unknown) =>
    Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const today = new Date();
  const months = property.contractMonths ?? 12;
  const endDate = new Date(today.getFullYear(), today.getMonth() + months, today.getDate());
  const fullAddress = [property.address, property.complement].filter(Boolean).join(', ');
  const ownerName = property.owner?.name ?? '';
  const rentFmt = fmt(property.rent);
  const depositFmt = fmt(property.deposit);

  return {
    // locatário
    locatario: lead.name ?? lead.phone,
    nome_locatario: lead.name ?? lead.phone,
    ...(cpf !== null ? { cpf_locatario: cpf } : {}),
    ...(rg !== null ? { rg_locatario: rg } : {}),
    telefone_locatario: lead.phone.replace(/@[^@]+$/, ''),
    // locador
    locador: ownerName,
    nome_locador: ownerName,
    ...(property.owner?.cpf ? { cpf_locador: property.owner.cpf } : {}),
    ...(property.owner?.cnpj ? { cnpj_locador: property.owner.cnpj } : {}),
    ...(property.owner?.address ? { endereco_locador: property.owner.address } : {}),
    // imóvel
    unidade: property.externalId,
    id_imovel: property.externalId,
    imovel: property.name,
    nome_imovel: property.name,
    endereco: fullAddress,
    endereco_imovel: fullAddress,
    complemento_imovel: property.complement ?? '',
    bairro: property.neighborhood,
    bairro_imovel: property.neighborhood,
    // valores
    aluguel: rentFmt,
    valor_aluguel: rentFmt,
    deposito: depositFmt,
    caucao: depositFmt,
    valor_caucao: depositFmt,
    // prazo e datas
    prazo_meses: String(months),
    prazo: String(months),
    data_hoje: formatDatePtBR(today),
    data_inicio: formatDatePtBR(today),
    data_termino: formatDatePtBR(endDate),
    data_assinatura: 'A ser preenchida na assinatura',
    vencimento: String(paymentDayOfMonth),
    dia_vencimento: String(paymentDayOfMonth),
  };
}
