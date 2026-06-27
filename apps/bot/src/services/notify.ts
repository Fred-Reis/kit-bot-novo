import { Resend } from 'resend';
import { config } from '@/config';
import { prisma } from '@/db/client';
import { logger } from '@/lib/logger';
import { maskCpf } from '@/services/cpf';
import { sendText } from '@/services/evolution';

const resend = config.RESEND_API_KEY ? new Resend(config.RESEND_API_KEY) : null;

type NotifyPayloadMap = {
  kyc_pending: { leadName: string; leadPhone: string; cpf: string | null };
  contract_signed: { leadName: string; tenantExternalId: string };
  payment_overdue: { tenantName: string; propertyName: string; daysOverdue: number };
};

type NotifyOwnerEventType = keyof NotifyPayloadMap;

type ChannelContent = {
  whatsapp: string;
  email: { subject: string; html: string } | null;
};

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildChannelContent(
  eventType: NotifyOwnerEventType,
  payload: NotifyPayloadMap[NotifyOwnerEventType],
): ChannelContent {
  switch (eventType) {
    case 'kyc_pending': {
      const { leadName, leadPhone, cpf } = payload as NotifyPayloadMap['kyc_pending'];
      const cpfStr = cpf ? ` — CPF: ${maskCpf(cpf)}` : '';
      const cpfHtml = cpf ? `<p>CPF: ${esc(maskCpf(cpf))}</p>` : '';
      return {
        whatsapp: `KYC pendente: ${leadName} (${leadPhone})${cpfStr}. Acesse o painel para revisar e aprovar.`,
        email: {
          subject: `KYC pendente — ${esc(leadName)}`,
          html: `<p>Lead: ${esc(leadName)}</p><p>Telefone: ${esc(leadPhone)}</p>${cpfHtml}<p>Acesse o painel para revisar os documentos e aprovar o KYC.</p>`,
        },
      };
    }
    case 'contract_signed': {
      const { leadName, tenantExternalId } = payload as NotifyPayloadMap['contract_signed'];
      return {
        whatsapp: `✅ Contrato assinado por ${leadName}. Inquilino criado: ${tenantExternalId}.`,
        email: {
          subject: `Contrato assinado — ${esc(leadName)}`,
          html: `<p>Contrato assinado por ${esc(leadName)}.</p><p>Inquilino criado: ${esc(tenantExternalId)}.</p>`,
        },
      };
    }
    case 'payment_overdue': {
      const { tenantName, propertyName, daysOverdue } = payload as NotifyPayloadMap['payment_overdue'];
      return {
        whatsapp: `Pagamento em atraso ha ${daysOverdue} dias: ${tenantName} - ${propertyName}.`,
        email: null,
      };
    }
  }
}

async function getOwnerInfo(ownerId: string): Promise<{
  phone: string;
  notificationPhone: string | null;
  notificationEmail: string | null;
} | null> {
  return prisma.owner.findUnique({
    where: { id: ownerId },
    select: { phone: true, notificationPhone: true, notificationEmail: true },
  });
}

export async function notifyOwner<T extends NotifyOwnerEventType>(
  ownerId: string,
  eventType: T,
  payload: NotifyPayloadMap[T],
): Promise<void> {
  try {
    const owner = await getOwnerInfo(ownerId);
    if (!owner) {
      logger.error({ ownerId }, 'notifyOwner: owner not found');
      return;
    }

    const { whatsapp, email } = buildChannelContent(eventType, payload);
    const phone = owner.notificationPhone ?? owner.phone;

    const sends: Promise<unknown>[] = [sendText(`${phone}@s.whatsapp.net`, whatsapp)];

    if (resend && owner.notificationEmail && email) {
      sends.push(
        resend.emails.send({
          from: 'kit-manager <notificacoes@kit-manager.app>',
          to: owner.notificationEmail,
          subject: email.subject,
          html: email.html,
        }),
      );
    }

    await Promise.all(sends);
  } catch (err) {
    logger.error({ err }, 'notifyOwner failed (non-blocking)');
  }
}
