import { tool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { prisma } from '@/db/client';
import { getChecklistForLead, renderChecklistText } from '@/flows/lead/checklist';
import { escalateToHuman } from '@/flows/lead/escalation';
import { logger } from '@/lib/logger';
import {
  describeProperty,
  describePropertyTerms,
  getPropertyByExternalId,
} from '@/services/catalog';

export interface ToolDeps {
  chatId: string;
  leadId: string;
  ownerId: string;
  leadName: string | null;
  propertyExternalId: string | null;
}

const VISIT_TZ = 'America/Sao_Paulo';

function fail(msg: string): string {
  return `Erro: ${msg}`;
}

async function checklistText(leadId: string): Promise<string> {
  const checklist = await getChecklistForLead(leadId);
  return renderChecklistText(checklist);
}

export function buildLeadTools(deps: ToolDeps): StructuredToolInterface[] {
  const statusChecklist = tool(
    async () => {
      try {
        return `Status da análise:\n${await checklistText(deps.leadId)}`;
      } catch (err) {
        logger.error({ err }, '[tools] status_checklist');
        return fail('não consegui consultar o checklist agora.');
      }
    },
    {
      name: 'status_checklist',
      description:
        'Consulta no banco o status real do checklist de análise do lead (renda, documentos, moradores). Use SEMPRE antes de afirmar qualquer coisa sobre documentos ou pendências.',
      schema: z.object({}),
    },
  );

  const registrarRenda = tool(
    async ({ valorMensal }: { valorMensal: number }) => {
      if (!Number.isFinite(valorMensal) || valorMensal <= 0) {
        return fail('valor de renda inválido.');
      }
      try {
        await prisma.lead.update({
          where: { id: deps.leadId },
          data: { declaredIncome: valorMensal },
        });
        return `Renda registrada: R$ ${valorMensal.toLocaleString('pt-BR')}.\n${await checklistText(deps.leadId)}`;
      } catch (err) {
        logger.error({ err }, '[tools] registrar_renda');
        return fail('não consegui registrar a renda agora.');
      }
    },
    {
      name: 'registrar_renda',
      description:
        'Registra a renda mensal declarada pelo lead (número em reais). Comprovante é opcional e não bloqueia.',
      schema: z.object({ valorMensal: z.number().describe('Renda mensal em reais, ex: 12000') }),
    },
  );

  const registrarMoradores = tool(
    async ({
      total,
      moradores,
    }: {
      total: number | null;
      moradores: Array<{ name: string; sex: string; age: number }>;
    }) => {
      try {
        if (total != null && total > 0) {
          await prisma.lead.update({
            where: { id: deps.leadId },
            data: { expectedResidents: total },
          });
        }
        if (moradores.length > 0) {
          await prisma.$transaction([
            prisma.leadResident.deleteMany({ where: { leadId: deps.leadId } }),
            prisma.leadResident.createMany({
              data: moradores.map((m) => ({
                leadId: deps.leadId,
                ownerId: deps.ownerId,
                name: m.name,
                sex: m.sex || null,
                age: m.age ?? null,
              })),
            }),
          ]);
        }
        return `Moradores atualizados.\n${await checklistText(deps.leadId)}`;
      } catch (err) {
        logger.error({ err }, '[tools] registrar_moradores');
        return fail('não consegui registrar os moradores agora.');
      }
    },
    {
      name: 'registrar_moradores',
      description:
        'Registra a quantidade total de moradores (quando o lead informar) e/ou a lista de moradores com nome, sexo e idade. Envie a lista COMPLETA a cada chamada (substitui a anterior).',
      schema: z.object({
        total: z.number().int().nullable().describe('Quantidade total de pessoas que vão morar; null se não informado'),
        moradores: z.array(
          z.object({ name: z.string(), sex: z.string(), age: z.number().int() }),
        ),
      }),
    },
  );

  const infoImovel = tool(
    async ({ externalId }: { externalId: string | null }) => {
      const id = externalId ?? deps.propertyExternalId;
      if (!id) return fail('nenhum imóvel em foco.');
      try {
        const property = await getPropertyByExternalId(id);
        if (!property || !property.active) return fail(`imóvel ${id} não encontrado ou inativo.`);
        return `${describeProperty(property)}\n\nCondições:\n${describePropertyTerms(property)}`;
      } catch (err) {
        logger.error({ err }, '[tools] info_imovel');
        return fail('não consegui consultar o imóvel agora.');
      }
    },
    {
      name: 'info_imovel',
      description:
        'Consulta fatos do imóvel no banco (valor, regras, localização, condições). Use antes de responder QUALQUER pergunta factual sobre imóvel. externalId null usa o imóvel em foco.',
      schema: z.object({ externalId: z.string().nullable() }),
    },
  );

  const agendarVisita = tool(
    async ({ dataHoraIso }: { dataHoraIso: string }) => {
      const date = new Date(dataHoraIso);
      if (isNaN(date.getTime())) return fail('data/hora inválida.');
      if (date <= new Date()) return fail('a data da visita precisa ser no futuro.');
      try {
        await prisma.lead.update({
          where: { id: deps.leadId },
          data: { scheduledVisitAt: date },
        });
        const dateStr = date.toLocaleDateString('pt-BR', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          timeZone: VISIT_TZ,
        });
        const timeStr = date.toLocaleTimeString('pt-BR', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: VISIT_TZ,
        });
        return `✅ Visita confirmada para ${dateStr} às ${timeStr}. Repasse esta confirmação ao lead.`;
      } catch (err) {
        logger.error({ err }, '[tools] agendar_visita');
        return fail('não consegui agendar agora.');
      }
    },
    {
      name: 'agendar_visita',
      description:
        'Agenda ou reagenda a visita quando o lead confirmar DATA e HORA específicas. Formato ISO com offset -03:00, ex: 2026-07-05T14:00:00-03:00. Visita é OPCIONAL — nunca insista.',
      schema: z.object({ dataHoraIso: z.string() }),
    },
  );

  const cancelarVisita = tool(
    async () => {
      try {
        await prisma.lead.update({
          where: { id: deps.leadId },
          data: { scheduledVisitAt: null },
        });
        return 'Visita cancelada com sucesso. Confirme ao lead de forma breve e positiva, sem questionar.';
      } catch (err) {
        logger.error({ err }, '[tools] cancelar_visita');
        return fail('não consegui cancelar agora.');
      }
    },
    {
      name: 'cancelar_visita',
      description: 'Cancela a visita agendada quando o lead pedir. Nunca questione o cancelamento.',
      schema: z.object({}),
    },
  );

  const escalarHumano = tool(
    async ({ motivo }: { motivo: string }) => {
      try {
        await escalateToHuman(deps.chatId, deps.ownerId, deps.leadName, 'human_request');
        logger.info({ motivo }, '[tools] escalar_humano');
        return 'Atendimento escalado para humano; o bot foi pausado. NÃO envie mais nada — o sistema já avisou o lead.';
      } catch (err) {
        logger.error({ err }, '[tools] escalar_humano');
        return fail('não consegui escalar agora.');
      }
    },
    {
      name: 'escalar_humano',
      description:
        'Pausa o bot e chama um atendente humano. Use quando o lead pedir para falar com pessoa, estiver insatisfeito, ou quando você não conseguir resolver com as outras tools.',
      schema: z.object({ motivo: z.string() }),
    },
  );

  return [
    statusChecklist,
    registrarRenda,
    registrarMoradores,
    infoImovel,
    agendarVisita,
    cancelarVisita,
    escalarHumano,
  ];
}
