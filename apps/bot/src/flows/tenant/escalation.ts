import { prisma } from '@/db/client';
import { logActivity } from '@/services/activity';
import { sendText } from '@/services/evolution';
import { buildTenantEscalationMessage, notifyOwner } from '@/services/notify';

export type TenantEscalationReason = 'human_request' | 'frustration' | 'out_of_scope';

const REASON_LABEL: Record<TenantEscalationReason, string> = {
  human_request: 'Inquilino pediu atendimento humano',
  frustration: 'Inquilino demonstrou frustração com o bot',
  out_of_scope: 'Pedido fora do que o bot já resolve sozinho hoje',
};

const TENANT_MESSAGE: Record<TenantEscalationReason, string> = {
  human_request:
    'Claro! Vou pedir para o proprietário assumir a conversa. Você recebe retorno em breve 🙂',
  frustration:
    'Peço desculpas pela experiência. Vou passar seu atendimento para o proprietário — retorno em breve.',
  out_of_scope:
    'Vou encaminhar isso direto para o proprietário, que consegue te ajudar melhor com esse assunto. Retorno em breve!',
};

export async function escalateTenantToOwner(
  chatId: string,
  ownerId: string,
  tenantId: string,
  tenantName: string | null,
  reason: TenantEscalationReason,
): Promise<void> {
  await prisma.conversation.upsert({
    where: { chatId },
    update: { botPaused: true },
    create: { chatId, data: {}, ownerId, botPaused: true },
  });

  const displayName = tenantName ?? chatId;

  await sendText(chatId, TENANT_MESSAGE[reason]);

  await notifyOwner(ownerId, 'tenant_escalation', {
    tenantName: displayName,
    tenantPhone: chatId,
    reason: REASON_LABEL[reason],
  });

  await logActivity({
    ownerId,
    actorType: 'bot',
    actorLabel: 'Bot',
    action: 'tenant_escalated',
    subjectType: 'tenant',
    subjectId: tenantId,
    subject: displayName,
    metadata: { reason },
  });
}
