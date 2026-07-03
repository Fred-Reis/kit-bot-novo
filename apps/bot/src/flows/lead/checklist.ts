import { prisma } from '@/db/client';
import type { LeadDocumentType } from '@/services/doc-classifier';

export interface ChecklistInput {
  name: string | null;
  declaredIncome: number | null;
  expectedResidents: number | null;
  residentsCollected: number;
  documents: LeadDocumentType[];
}

export interface ChecklistStatus {
  name: boolean;
  income: boolean;
  identity: { complete: boolean; have: LeadDocumentType[]; missing: string[] };
  residents: { complete: boolean; expected: number | null; collected: number };
  complete: boolean;
}

function identityStatus(documents: LeadDocumentType[]): ChecklistStatus['identity'] {
  const have = documents.filter((d) => d !== 'unknown' && d !== 'income_proof') as LeadDocumentType[];
  const has = (t: LeadDocumentType) => have.some((d) => d === t);

  if (has('cnh_full') || (has('cnh_front') && has('cnh_back'))) {
    return { complete: true, have, missing: [] };
  }
  if (has('rg_front') && has('rg_back') && has('cpf')) {
    return { complete: true, have, missing: [] };
  }

  // Caminho CNH iniciado
  if (has('cnh_front')) return { complete: false, have, missing: ['verso da CNH'] };
  if (has('cnh_back')) return { complete: false, have, missing: ['frente da CNH'] };

  // Caminho RG+CPF iniciado
  if (has('rg_front') || has('rg_back') || has('cpf')) {
    const missing: string[] = [];
    if (!has('rg_front')) missing.push('frente do RG');
    if (!has('rg_back')) missing.push('verso do RG');
    if (!has('cpf')) missing.push('CPF');
    return { complete: false, have, missing };
  }

  return {
    complete: false,
    have,
    missing: ['CNH (frente e verso, ou foto única aberta) ou RG + CPF'],
  };
}

export function buildChecklist(input: ChecklistInput): ChecklistStatus {
  const identity = identityStatus(input.documents);
  const income = input.declaredIncome != null && input.declaredIncome > 0;
  const residents = {
    expected: input.expectedResidents,
    collected: input.residentsCollected,
    complete:
      input.expectedResidents != null &&
      input.expectedResidents >= 0 &&
      input.residentsCollected >= input.expectedResidents,
  };
  const name = !!(input.name ?? '').trim();

  return {
    name,
    income,
    identity,
    residents,
    complete: name && income && identity.complete && residents.complete,
  };
}

export function renderChecklistText(status: ChecklistStatus): string {
  const lines: string[] = [];
  lines.push(status.income ? '✅ Renda' : '⬜ Renda mensal (pode ser só o valor)');
  lines.push(
    status.identity.complete
      ? '✅ Documento de identidade'
      : `⬜ Documento de identidade (falta: ${status.identity.missing.join(', ')})`,
  );
  lines.push(
    status.residents.complete
      ? '✅ Moradores'
      : status.residents.expected == null
        ? '⬜ Moradores (quantas pessoas vão morar?)'
        : `⬜ Moradores (${status.residents.collected} de ${status.residents.expected} informados)`,
  );
  return lines.join('\n');
}

export function renderChecklistContext(status: ChecklistStatus): string {
  return [
    `Checklist da analise (fonte: banco de dados — NUNCA contradiga):`,
    `- Nome: ${status.name ? 'ok' : 'pendente'}`,
    `- Renda declarada: ${status.income ? 'ok' : 'pendente'}`,
    `- Identidade: ${status.identity.complete ? 'completa' : `pendente (falta: ${status.identity.missing.join(', ')})`}`,
    `- Documentos recebidos: ${status.identity.have.length > 0 ? status.identity.have.join(', ') : 'nenhum'}`,
    `- Moradores: ${status.residents.complete ? 'completos' : status.residents.expected == null ? 'quantidade ainda nao informada' : `${status.residents.collected} de ${status.residents.expected}`}`,
    `- Analise pronta para envio: ${status.complete}`,
  ].join('\n');
}

export async function getChecklistForLead(leadId: string): Promise<ChecklistStatus> {
  const [lead, documents, residentsCount] = await Promise.all([
    prisma.lead.findUnique({
      where: { id: leadId },
      select: { name: true, declaredIncome: true, expectedResidents: true },
    }),
    prisma.leadDocument.findMany({ where: { leadId }, select: { type: true } }),
    prisma.leadResident.count({ where: { leadId } }),
  ]);

  return buildChecklist({
    name: lead?.name ?? null,
    declaredIncome: lead?.declaredIncome != null ? Number(lead.declaredIncome) : null,
    expectedResidents: lead?.expectedResidents ?? null,
    residentsCollected: residentsCount,
    documents: documents.map((d) => d.type as LeadDocumentType),
  });
}
