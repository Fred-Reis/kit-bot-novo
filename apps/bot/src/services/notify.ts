import type { MaintenanceResponsibility, MaintenanceSeverity, MaintenanceType } from '@kit-manager/types';
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
  human_needed: { leadName: string; leadPhone: string; reason: string };
  media_receive_failure: { leadName: string; leadPhone: string; failureCount: number };
  tenant_escalation: { tenantName: string; tenantPhone: string; reason: string };
  tenant_emergency: { tenantName: string; tenantPhone: string; propertyName: string };
  tenant_complaint: { tenantName: string; tenantPhone: string; summary: string };
  tenant_maintenance_request: {
    tenantName: string;
    tenantPhone: string;
    summary: string;
    type: MaintenanceType;
    responsibility: MaintenanceResponsibility;
    severity: MaintenanceSeverity;
  };
  tenant_media_forwarded: { tenantName: string; tenantPhone: string; mediaUrls: string[] };
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
    case 'human_needed': {
      const p = payload as NotifyPayloadMap['human_needed'];
      return {
        whatsapp:
          `⚠️ Atendimento humano necessário\n` +
          `Lead: ${p.leadName} (${p.leadPhone})\n` +
          `Motivo: ${p.reason}\n` +
          `O bot foi pausado para este contato.`,
        email: null,
      };
    }
    case 'media_receive_failure': {
      const p = payload as NotifyPayloadMap['media_receive_failure'];
      return {
        whatsapp:
          `⚠️ Falha ao receber arquivo de ${p.leadName} (${p.leadPhone}) — ` +
          `${p.failureCount} tentativas sem sucesso. O bot NÃO foi pausado, pode ser só uma instabilidade — vale conferir com o lead.`,
        email: null,
      };
    }
    case 'tenant_escalation': {
      const p = payload as NotifyPayloadMap['tenant_escalation'];
      return { whatsapp: buildTenantEscalationMessage(p), email: null };
    }
    case 'tenant_emergency': {
      const p = payload as NotifyPayloadMap['tenant_emergency'];
      return { whatsapp: buildTenantEmergencyMessage(p), email: null };
    }
    case 'tenant_complaint': {
      const p = payload as NotifyPayloadMap['tenant_complaint'];
      return { whatsapp: buildTenantComplaintMessage(p), email: null };
    }
    case 'tenant_maintenance_request': {
      const p = payload as NotifyPayloadMap['tenant_maintenance_request'];
      return { whatsapp: buildTenantMaintenanceRequestMessage(p), email: null };
    }
    case 'tenant_media_forwarded': {
      const p = payload as NotifyPayloadMap['tenant_media_forwarded'];
      return { whatsapp: buildTenantMediaForwardedMessage(p), email: null };
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
    const rawPhone = owner.notificationPhone ?? owner.phone;
    // Normalize to Evolution API format: strip leading + (E.164 → WhatsApp JID)
    const phone = rawPhone ? rawPhone.replace(/^\+/, '') : null;

    const labeled: { label: string; promise: Promise<unknown> }[] = [];

    if (!phone) {
      logger.warn({ ownerId, eventType }, 'notifyOwner: no phone configured — skipping WhatsApp notification');
    } else {
      labeled.push({ label: 'whatsapp', promise: sendText(`${phone}@s.whatsapp.net`, whatsapp) });
    }

    if (resend && owner.notificationEmail && email) {
      labeled.push({
        label: 'email',
        promise: resend.emails.send({
          from: 'kit-manager <notificacoes@kit-manager.app>',
          to: owner.notificationEmail,
          subject: email.subject,
          html: email.html,
        }),
      });
    }

    const results = await Promise.allSettled(labeled.map((l) => l.promise));
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        logger.warn({ err: r.reason, channel: labeled[i]?.label }, 'notifyOwner: channel failed');
      }
    });
  } catch (err) {
    logger.error({ err }, 'notifyOwner failed (non-blocking)');
  }
}

export function buildTenantEscalationMessage(payload: {
  tenantName: string;
  tenantPhone: string;
  reason: string;
}): string {
  return (
    `⚠️ Inquilino precisa de atenção\n` +
    `Inquilino: ${payload.tenantName} (${payload.tenantPhone})\n` +
    `Motivo: ${payload.reason}\n` +
    `O bot foi pausado para este contato.`
  );
}

export function buildTenantEmergencyMessage(payload: {
  tenantName: string;
  tenantPhone: string;
  propertyName: string;
}): string {
  return (
    `🚨 EMERGÊNCIA reportada por inquilino\n` +
    `Inquilino: ${payload.tenantName} (${payload.tenantPhone})\n` +
    `Imóvel: ${payload.propertyName}\n` +
    `Ligue para o inquilino agora, se possível.`
  );
}

export function buildTenantComplaintMessage(payload: {
  tenantName: string;
  tenantPhone: string;
  summary: string;
}): string {
  return (
    `📋 Nova reclamação registrada\n` +
    `Inquilino: ${payload.tenantName} (${payload.tenantPhone})\n` +
    `Resumo: ${payload.summary}\n` +
    `Acesse o painel para ver os detalhes.`
  );
}

const RESPONSIBILITY_LABEL: Record<MaintenanceResponsibility, string> = {
  tenant: 'inquilino',
  owner: 'proprietário',
  unclear: 'indefinida',
};

const MAINTENANCE_TYPE_LABEL: Record<MaintenanceType, string> = {
  eletrica: 'Elétrica',
  hidraulica: 'Hidráulica',
  civil: 'Civil',
  limpeza_conservacao: 'Limpeza/Conservação',
};

export function buildTenantMaintenanceRequestMessage(payload: {
  tenantName: string;
  tenantPhone: string;
  summary: string;
  type: MaintenanceType;
  responsibility: MaintenanceResponsibility;
  severity: MaintenanceSeverity;
}): string {
  return (
    `🔧 Novo chamado de manutenção\n` +
    `Inquilino: ${payload.tenantName} (${payload.tenantPhone})\n` +
    `Tipo: ${MAINTENANCE_TYPE_LABEL[payload.type]}\n` +
    `Resumo: ${payload.summary}\n` +
    `Responsabilidade sugerida: ${RESPONSIBILITY_LABEL[payload.responsibility]}\n` +
    `Severidade: ${payload.severity}\n` +
    `Acesse o painel para ver os detalhes.`
  );
}

export function buildTenantMediaForwardedMessage(payload: {
  tenantName: string;
  tenantPhone: string;
  mediaUrls: string[];
}): string {
  const links =
    payload.mediaUrls.length > 0
      ? payload.mediaUrls.join('\n')
      : 'Não consegui gerar o link agora — acesse o painel para ver o arquivo recebido.';
  return (
    `📎 Inquilino enviou um arquivo sem chamado aberto\n` +
    `Inquilino: ${payload.tenantName} (${payload.tenantPhone})\n` +
    `${links}`
  );
}

export function buildVisitScheduledMessage(payload: {
  leadName: string;
  leadPhone: string;
  scheduledVisitAt: string;
  propertyExternalId: string;
}): string {
  const date = new Date(payload.scheduledVisitAt);
  const tz = 'America/Sao_Paulo';
  const dateStr = date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: tz,
  });
  const timeStr = date.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: tz,
  });
  return (
    `📅 Nova visita agendada\n` +
    `Imóvel: ${payload.propertyExternalId}\n` +
    `Lead: ${payload.leadName} (${payload.leadPhone})\n` +
    `Data: ${dateStr} às ${timeStr}`
  );
}

export async function notifyCoordinators(
  propertyId: string,
  payload: {
    leadName: string;
    leadPhone: string;
    scheduledVisitAt: string;
    propertyExternalId: string;
  },
): Promise<void> {
  try {
    const links = await prisma.propertyCoordinator.findMany({
      where: { propertyId, responsibilities: { has: 'show_property' } },
      include: { coordinator: true },
    });
    if (links.length === 0) return;

    const message = buildVisitScheduledMessage(payload);
    const results = await Promise.allSettled(
      links.map((link) => {
        const phone = link.coordinator.phone.replace(/^\+/, '');
        return sendText(`${phone}@s.whatsapp.net`, message);
      }),
    );
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        logger.warn(
          { err: r.reason, coordinatorId: links[i]?.coordinatorId },
          'notifyCoordinators: whatsapp send failed',
        );
      }
    });
  } catch (err) {
    logger.error({ err }, 'notifyCoordinators failed (non-blocking)');
  }
}
