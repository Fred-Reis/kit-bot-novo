import { prisma } from '@/db/client';
import { logger } from '@/lib/logger';
import { logActivity } from '@/services/activity';
import { sendText } from '@/services/evolution';
import { notifyOwner } from '@/services/notify';

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
  detail?: string,
): Promise<void> {
  await prisma.conversation.upsert({
    where: { chatId },
    update: { botPaused: true },
    create: { chatId, data: {}, ownerId, botPaused: true },
  });

  const displayName = tenantName ?? chatId;
  // `detail` is the LLM's free-text motivo for the escalar_owner tool path —
  // enriches the owner-facing label without expanding the reason enum.
  const reasonLabel = detail ? `${REASON_LABEL[reason]}: ${detail}` : REASON_LABEL[reason];

  // Each side effect below is independent and best-effort: a failure in one
  // (e.g. Evolution API down) must never block the others from being
  // attempted — botPaused is already committed above, so if notifyOwner
  // never ran the owner would have zero signal that this tenant is stuck.
  await Promise.allSettled([
    sendText(chatId, TENANT_MESSAGE[reason]).catch((err) =>
      logger.error({ err, chatId }, '[tenant.escalation] Falha ao avisar inquilino'),
    ),
    // Persisted here (not by the caller) so every caller — the frustration
    // branch in flows/tenant/index.ts and the escalar_owner tool, whose
    // reply crosses an LLM tool-call boundary the orchestrator can't see
    // into — gets a correct Event record for what was actually sent,
    // without having to thread the message text back out.
    prisma.event
      .create({ data: { chatId, role: 'assistant', content: TENANT_MESSAGE[reason], ownerId } })
      .catch((err) => logger.error({ err, chatId }, '[tenant.escalation] Falha ao persistir Event')),
    notifyOwner(ownerId, 'tenant_escalation', {
      tenantName: displayName,
      tenantPhone: chatId,
      reason: reasonLabel,
    }).catch((err) => logger.error({ err, ownerId }, '[tenant.escalation] notifyOwner falhou')),
    logActivity({
      ownerId,
      actorType: 'bot',
      actorLabel: 'Bot',
      action: 'tenant_escalated',
      subjectType: 'tenant',
      subjectId: tenantId,
      subject: displayName,
      metadata: detail ? { reason, detail } : { reason },
    }).catch((err) => logger.error({ err, tenantId }, '[tenant.escalation] logActivity falhou')),
  ]);
}
