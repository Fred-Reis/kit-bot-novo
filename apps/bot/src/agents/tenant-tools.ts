import { tool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { escalateTenantToOwner } from '@/flows/tenant/escalation';
import { logger } from '@/lib/logger';

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
        await escalateTenantToOwner(deps.chatId, deps.ownerId, deps.tenantId, deps.tenantName, 'out_of_scope');
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

  return [escalarOwner];
}
