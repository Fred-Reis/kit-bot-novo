import { tool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { prisma } from '@/db/client';
import { escalateTenantToOwner } from '@/flows/tenant/escalation';
import { logger } from '@/lib/logger';
import { logActivity } from '@/services/activity';
import { notifyOwner } from '@/services/notify';

export interface TenantToolDeps {
  chatId: string;
  tenantId: string;
  ownerId: string;
  tenantName: string | null;
}

function fail(msg: string): string {
  return `Erro: ${msg}`;
}

export function buildTenantTools(deps: TenantToolDeps): StructuredToolInterface[] {
  const escalarOwner = tool(
    async ({ motivo }: { motivo: string }) => {
      try {
        await escalateTenantToOwner(deps.chatId, deps.ownerId, deps.tenantId, deps.tenantName, 'out_of_scope', motivo);
        logger.info({ motivo }, '[tenant-tools] escalar_owner');
        return 'Assunto encaminhado ao proprietário; o bot foi pausado. NÃO envie mais nada — o sistema já avisou o inquilino.';
      } catch (err) {
        logger.error({ err }, '[tenant-tools] escalar_owner');
        return fail('não consegui encaminhar agora.');
      }
    },
    {
      name: 'escalar_owner',
      description:
        'Pausa o bot e encaminha o assunto ao proprietário. Use quando o inquilino pedir negociação, ' +
        'estiver insatisfeito, pedir atendimento humano, ou trouxer um assunto (manutenção, financeiro) ' +
        'que o bot ainda não resolve sozinho.',
      schema: z.object({ motivo: z.string() }),
    },
  );

  const registrarReclamacao = tool(
    async ({ resumo, conteudo }: { resumo: string; conteudo: string }) => {
      try {
        const complaint = await prisma.complaint.create({
          data: { ownerId: deps.ownerId, tenantId: deps.tenantId, summary: resumo, content: conteudo },
        });
        const displayName = deps.tenantName ?? deps.chatId;
        notifyOwner(deps.ownerId, 'tenant_complaint', {
          tenantName: displayName,
          tenantPhone: deps.chatId,
          summary: resumo,
        }).catch((err) => logger.error({ err }, '[tenant-tools] notifyOwner tenant_complaint falhou'));
        logActivity({
          ownerId: deps.ownerId,
          actorType: 'bot',
          actorLabel: 'Bot',
          action: 'complaint_registered',
          subjectType: 'complaint',
          subjectId: complaint.id,
          subject: displayName,
          metadata: { summary: resumo },
        }).catch((err) => logger.error({ err }, '[tenant-tools] logActivity complaint_registered falhou'));
        return 'Reclamação registrada. O proprietário foi avisado e vai acompanhar o caso.';
      } catch (err) {
        logger.error({ err }, '[tenant-tools] registrar_reclamacao');
        return fail('não consegui registrar a reclamação agora.');
      }
    },
    {
      name: 'registrar_reclamacao',
      description:
        'Registra uma reclamação formal do inquilino (ex: barulho, problema recorrente não resolvido, ' +
        'insatisfação com atendimento). Cria registro no sistema e notifica o proprietário. ' +
        'resumo: uma linha curta. conteudo: o relato completo do inquilino, sem resumir ou inventar detalhes.',
      schema: z.object({ resumo: z.string(), conteudo: z.string() }),
    },
  );

  return [escalarOwner, registrarReclamacao];
}
