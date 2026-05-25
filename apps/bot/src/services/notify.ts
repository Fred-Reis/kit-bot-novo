import { prisma } from '../db/client';
import { sendText } from './evolution';

type NotifyPayloadMap = {
  kyc_pending: { leadName: string; leadPhone: string };
  contract_signed: { leadName: string };
  payment_overdue: { tenantName: string; propertyName: string; daysOverdue: number };
};

type NotifyOwnerEventType = keyof NotifyPayloadMap;

type NotifyArgs =
  | { eventType: 'kyc_pending'; payload: NotifyPayloadMap['kyc_pending'] }
  | { eventType: 'contract_signed'; payload: NotifyPayloadMap['contract_signed'] }
  | { eventType: 'payment_overdue'; payload: NotifyPayloadMap['payment_overdue'] };

function buildMessage(args: NotifyArgs): string {
  switch (args.eventType) {
    case 'kyc_pending':
      return `KYC pendente: ${args.payload.leadName} (${args.payload.leadPhone}) enviou documentos para analise.`;
    case 'contract_signed':
      return `✅ Contrato assinado por ${args.payload.leadName}. Próximo passo: confirmar pagamento.`;
    case 'payment_overdue':
      return `Pagamento em atraso ha ${args.payload.daysOverdue} dias: ${args.payload.tenantName} - ${args.payload.propertyName}.`;
  }
}

const ownerPhoneCache = new Map<string, string>();

async function getOwnerPhone(ownerId: string): Promise<string | null> {
  const cached = ownerPhoneCache.get(ownerId);
  if (cached) return cached;
  const owner = await prisma.owner.findUnique({ where: { id: ownerId } });
  if (!owner) return null;
  const phone = owner.notificationPhone ?? owner.phone;
  ownerPhoneCache.set(ownerId, phone);
  return phone;
}

export async function notifyOwner<T extends NotifyOwnerEventType>(
  ownerId: string,
  eventType: T,
  payload: NotifyPayloadMap[T],
): Promise<void> {
  try {
    const phone = await getOwnerPhone(ownerId);
    if (!phone) {
      console.error(`notifyOwner: owner ${ownerId} not found`);
      return;
    }
    const message = buildMessage({ eventType, payload } as NotifyArgs);
    await sendText(`${phone}@s.whatsapp.net`, message);
  } catch (err) {
    console.error('notifyOwner failed (non-blocking):', err);
  }
}
