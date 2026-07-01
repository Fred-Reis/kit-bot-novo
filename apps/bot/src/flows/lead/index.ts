// Port of flows/lead_flow.py

import { extractLeadUpdate, routeLeadMessage, runLeadAgent } from '@/agents/lead';
import type { MediaItem } from '@/buffer';
import { prisma } from '@/db/client';
import { buildLeadSnapshot, type LeadContext, renderLeadContext } from '@/flows/lead/context';
import { getSimpleGreetingReply, normalizeIntentText } from '@/flows/lead/intents';
import { shouldTransitionToKyc, shouldUpdateLeadSource } from '@/flows/lead/kyc';
import {
  findPropertyMedia,
  getRequestedMediaType,
  mediaCaption,
  shouldSendMediaDeterministically,
} from '@/flows/lead/media';
import { resolveTargetAgent } from '@/flows/lead/rules';
import { fsmStateToLeadStage } from '@/flows/lead/stage-map';
import { logger } from '@/lib/logger';
import {
  findMatchingProperty,
  getPropertyByExternalId,
  listAvailableProperties,
  summarizeProperty,
} from '@/services/catalog';
import { extractCpfFromDocs } from '@/services/cpf';
import { sendMedia, sendText } from '@/services/evolution';
import { notifyOwner } from '@/services/notify';
import { extractTextFromImage } from '@/services/ocr';

const CHAT_HISTORY_LIMIT = 10;

const CONFIRMATION_WORDS = [
  'sim', 'correto', 'certo', 'ok', 'isso', 'exato', 'perfeito', 'confirmo', 'pode',
];

const REJECTION_WORDS = ['nao', 'errado', 'incorreto'];

function isAudioMedia(item: MediaItem): boolean {
  return (item.mime ?? '').startsWith('audio/') || (item.type ?? '').startsWith('audio');
}

function isDocMedia(item: MediaItem): boolean {
  if (!item.url) return false;
  const type = item.type ?? '';
  const mime = item.mime ?? '';
  return (
    type === 'image' ||
    type === 'document' ||
    mime.startsWith('image/') ||
    mime === 'application/pdf'
  );
}

async function loadChatHistory(
  chatId: string,
): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  const events = await prisma.event.findMany({
    where: { chatId },
    orderBy: { createdAt: 'desc' },
    take: CHAT_HISTORY_LIMIT,
  });
  return events
    .reverse()
    .filter((event) => event.role === 'user' || event.role === 'assistant')
    .map((event) => ({ role: event.role as 'user' | 'assistant', content: event.content }));
}

async function loadLeadDocuments(leadId: string): Promise<Array<{ ocrText: string | null }>> {
  return prisma.leadDocument.findMany({
    where: { leadId },
    select: { ocrText: true },
    orderBy: { createdAt: 'desc' },
  });
}

async function loadOrCreateConversation(chatId: string): Promise<LeadContext> {
  const conv = await prisma.conversation.findUnique({ where: { chatId } });
  if (conv && conv.data && typeof conv.data === 'object') {
    return conv.data as LeadContext;
  }
  return {};
}

async function persistConversation(
  chatId: string,
  context: LeadContext,
  userMessage: string | null,
  assistantReply: string | null,
  ownerId: string,
): Promise<void> {
  const ops: Array<ReturnType<typeof prisma.event.create>> = [];

  if (userMessage) {
    ops.push(
      prisma.event.create({
        data: { chatId, role: 'user', content: userMessage, ownerId },
      }),
    );
  }
  if (assistantReply) {
    ops.push(
      prisma.event.create({
        data: { chatId, role: 'assistant', content: assistantReply, ownerId },
      }),
    );
  }

  await prisma.$transaction([
    prisma.conversation.upsert({
      where: { chatId },
      update: { data: context as object },
      create: { chatId, data: context as object, ownerId, botPaused: false },
    }),
    ...ops,
  ]);
}

async function persistLeadDocuments(
  leadId: string,
  mediaItems: MediaItem[],
  docsPreference: 'cnh' | 'rg_cpf' | null,
  ownerId: string,
): Promise<void> {
  const docItems = mediaItems.filter(isDocMedia);
  if (docItems.length === 0) return;

  const docType = docsPreference ?? 'image';

  await Promise.all(
    docItems.map(async (m) => {
      const ocrText = await extractTextFromImage(m.url!);
      return prisma.leadDocument.create({
        data: {
          leadId,
          type: docType,
          url: m.url!,
          ocrText: ocrText || null,
          ownerId,
        },
      });
    }),
  );
}

export async function handleLeadMessage(
  chatId: string,
  text: string | null,
  mediaItems: MediaItem[],
  ownerId: string,
): Promise<void> {
  logger.info({ chatId }, '[lead.flow] Message received');

  const messageText = text ?? '';
  let replyText: string | null = null;
  let bypassAgentReply = false;

  try {
    // 1. Load lead + conversation
    const lead = await prisma.lead.findUnique({ where: { phone: chatId } });
    if (!lead) {
      logger.error({ chatId }, '[lead.flow] No lead record');
      return;
    }

    const context = await loadOrCreateConversation(chatId);
    const chatHistory = await loadChatHistory(chatId);

    // 2. Reset per-turn transient flags
    context.wantsPause = false;
    context.wantsHuman = false;
    context.wantsOptions = false;
    context.wantsSchedule = false;
    context.wantsApplication = false;
    context.audioReceived = false;

    // 3. Detect requested media type before anything else
    const requestedMediaType = getRequestedMediaType(messageText, context);
    if (requestedMediaType) {
      context.lastRequestedMediaType = requestedMediaType;
    }

    // 4. Deterministic greeting check (skip LLM entirely)
    const greetingReply = mediaItems.length === 0 ? getSimpleGreetingReply(messageText) : null;
    if (greetingReply) {
      context.lastUserMessage = messageText;
      context.lastRoutedAgent = 'deterministic_greeting';
      await persistConversation(chatId, context, messageText, greetingReply, ownerId);
      await sendText(chatId, greetingReply);
      return;
    }

    // 5. LLM extraction → merge into context (pass available properties so extractor can infer)
    const leadPatch: Record<string, unknown> = {};

    if (messageText) {
      const availableProps = await listAvailableProperties();
      const availableSummary = availableProps.map((p) => summarizeProperty(p)).join('\n');
      const { extractedSource, scheduledVisitAt: extractedVisitAt, ...updates } = await extractLeadUpdate(
        messageText,
        context,
        availableSummary,
      );
      Object.assign(context, updates);

      // Don't overwrite manual source corrections made in the admin panel
      if (shouldUpdateLeadSource(lead.source, extractedSource)) {
        leadPatch.source = extractedSource;
      }

      // Persist confirmed visit date — only advance, never regress
      if (extractedVisitAt) {
        const proposedDate = new Date(extractedVisitAt);
        if (!isNaN(proposedDate.getTime()) && proposedDate > new Date()) {
          leadPatch.scheduledVisitAt = proposedDate;
        }
      }
    }

    // 6. Handle audio flag
    const audioReceived = mediaItems.some(isAudioMedia);
    context.audioReceived = audioReceived;

    // 7. Persist document images
    await persistLeadDocuments(lead.id, mediaItems, context.docsPreference ?? null, ownerId);

    // Reset data confirmation if new documents were submitted this turn
    if (mediaItems.some(isDocMedia) && (context.dataConfirmed || context.dataConfirmationSent)) {
      context.dataConfirmed = false;
      context.dataConfirmationSent = false;
    }

    // 8. Resolve property in focus
    const propertyReference = (context.propertyReference ?? '').trim();
    const propertyInterest = (context.propertyInterest ?? '').trim();

    if (propertyReference) {
      const resolved = await getPropertyByExternalId(propertyReference);
      if (resolved) {
        context.propertyReference = resolved.externalId;
        context.propertyTitle = resolved.name;
        context.propertyReferenceLocked = true;
      }
    } else if (propertyInterest) {
      const matched = await findMatchingProperty(propertyInterest);
      if (matched) {
        context.propertyReference = matched.externalId;
        context.propertyTitle = matched.name;
        context.propertyReferenceLocked = true;
      }
    }

    // 9. Derive visit_requested flag
    if (context.visitedProperty === false && context.wantsSchedule) {
      context.visitRequested = true;
    } else if (context.visitedProperty !== false) {
      context.visitRequested = false;
    }

    if (context.visitedProperty === true) {
      context.propertyReferenceLocked = !!(context.propertyReference ?? '');
    }

    // 10. Build snapshot → derive state
    let snapshot = await buildLeadSnapshot(lead.id, context);

    if (snapshot.state === 'lead.review_submitted') {
      context.analysisSubmitted = true;
      snapshot = await buildLeadSnapshot(lead.id, context);
    } else {
      context.analysisSubmitted = false;
    }

    context.docsReceivedCount = snapshot.docsReceivedCount;

    if (snapshot.propertyInFocus?.id && snapshot.propertyInFocus.id !== lead.propertyId) {
      leadPatch.propertyId = snapshot.propertyInFocus.id;
    }

    // Persistir nome extraído pelo LLM
    if (context.name && context.name !== lead.name) {
      leadPatch.name = context.name;
    }

    // Sincronizar Lead.stage com o estado da conversa
    const mappedStage = fsmStateToLeadStage(snapshot.state, lead.stage);
    if (mappedStage && mappedStage !== lead.stage) {
      leadPatch.stage = mappedStage;
    }

    const kycTransition = shouldTransitionToKyc(
      snapshot.docsStage,
      (context.residents ?? []).length,
      snapshot.residentsComplete,
      lead.stage,
      context.dataConfirmed ?? false,
    );
    if (kycTransition) {
      leadPatch.stage = 'kyc_pending';
    }

    if (Object.keys(leadPatch).length > 0) {
      await prisma.lead.update({ where: { phone: chatId }, data: leadPatch });
    }

    if (kycTransition) {
      const kycDocs = await loadLeadDocuments(lead.id);
      notifyOwner(lead.ownerId, 'kyc_pending', {
        leadName: lead.name ?? chatId,
        leadPhone: chatId,
        cpf: extractCpfFromDocs(kycDocs),
      }).catch((err) => logger.error({ err }, '[lead.flow] notifyOwner kyc_pending failed'));
    }

    // Visit confirmation: fire on every new/changed visit date
    const newVisitAt = leadPatch.scheduledVisitAt as Date | undefined;
    const visitDateChanged =
      newVisitAt != null &&
      (lead.scheduledVisitAt == null || newVisitAt.getTime() !== lead.scheduledVisitAt.getTime());

    if (visitDateChanged) {
      const dateStr = newVisitAt.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
      const timeStr = newVisitAt.toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
      });
      const propertyName = snapshot.propertyInFocus?.name ?? 'o imóvel';
      sendText(
        chatId,
        `✅ Visita confirmada! Aguardamos você no dia ${dateStr} às ${timeStr} no ${propertyName}. Qualquer dúvida, é só chamar!`,
      ).catch((err) => logger.error({ err }, '[lead.flow] Failed to send visit confirmation'));
    }

    // Data confirmation gate — deterministic flow, always returns early
    if (snapshot.state === 'lead.data_confirmation') {
      const replyDC = async (msg: string): Promise<void> => {
        context.state = 'lead.data_confirmation';
        context.lastUserMessage = messageText;
        context.lastRoutedAgent = 'deterministic_data_confirmation';
        await persistConversation(chatId, context, messageText || null, msg, ownerId);
        await sendText(chatId, msg);
      };

      if (!context.dataConfirmationSent) {
        const docs = await loadLeadDocuments(lead.id);
        const cpf = extractCpfFromDocs(docs);

        if (!cpf) {
          await replyDC(
            'Não consegui ler o CPF no documento. Pode enviar uma foto mais nítida, com boa iluminação e sem reflexo?',
          );
          return;
        }

        const confirmName = context.name ?? lead.name ?? 'não informado';
        context.dataConfirmationSent = true;
        await replyDC(
          'Por favor, confirme seus dados:\n\n' +
            `Nome: ${confirmName}\n` +
            `CPF: ${cpf}\n\n` +
            'Está correto? Responda *sim* para confirmar ou *não* para corrigir.',
        );
        return;
      }

      const normalized = normalizeIntentText(messageText);
      const hasRejection = REJECTION_WORDS.some((w) => normalized.includes(w));
      const isConfirmed = !hasRejection && CONFIRMATION_WORDS.some((w) => normalized.includes(w));

      if (isConfirmed) {
        context.dataConfirmed = true;
        await prisma.lead.update({ where: { phone: chatId }, data: { stage: 'kyc_pending' } });

        const docs = await loadLeadDocuments(lead.id);
        notifyOwner(lead.ownerId, 'kyc_pending', {
          leadName: lead.name ?? chatId,
          leadPhone: chatId,
          cpf: extractCpfFromDocs(docs),
        }).catch((err) => logger.error({ err }, '[lead.flow] notifyOwner kyc_pending failed'));

        await replyDC(
          '✅ Dados confirmados! Seus documentos foram enviados para análise. Em breve entraremos em contato.',
        );
        return;
      }
      // Explicit rejection: reset flag so next turn re-extracts and re-prompts after correction
      if (hasRejection) {
        context.dataConfirmationSent = false;
      }
      // Fall through to agent (collection agent handles correction dialogue)
    }

    // 11. Check for deterministic media send
    const propertyInFocus = snapshot.propertyInFocus;
    const outboundMedia = findPropertyMedia(propertyInFocus, requestedMediaType);
    bypassAgentReply = shouldSendMediaDeterministically(requestedMediaType, outboundMedia);

    // Listing links (OLX, etc.) can't be sent via sendMedia — send as text link instead
    const isListingLink = outboundMedia?.type === 'listing' && !!outboundMedia.url;
    if (isListingLink && requestedMediaType === 'listing') {
      bypassAgentReply = true;
    }

    const leadContextStr = renderLeadContext(snapshot);

    // 12. Determine the question to pass to agent
    let question: string;
    if (messageText) {
      question = messageText;
    } else if (audioReceived) {
      question = 'O usuario enviou um audio sem texto.';
    } else {
      question = 'O usuario enviou apenas midia.';
    }

    // 13. Route and run agent (unless deterministic media bypass)
    let targetAgent: string = 'info';
    if (!bypassAgentReply) {
      const routedAgent = await routeLeadMessage(question, leadContextStr);
      targetAgent = resolveTargetAgent(snapshot.state, routedAgent);
      replyText = await runLeadAgent(
        targetAgent as Parameters<typeof runLeadAgent>[0],
        question,
        leadContextStr,
        chatHistory,
      );
    } else {
      targetAgent = 'deterministic_media';
    }

    // 14. Persist conversation state + events
    context.lastUserMessage = messageText;
    context.lastRoutedAgent = targetAgent;
    context.state = snapshot.state;

    await persistConversation(chatId, context, messageText || null, replyText, ownerId);

    // 15. Send outbound media or listing link
    if (outboundMedia && bypassAgentReply) {
      try {
        if (isListingLink) {
          const label = outboundMedia.label ?? 'Anúncio do imóvel';
          replyText = `${label}: ${outboundMedia.url}`;
        } else {
          const caption = mediaCaption(propertyInFocus, outboundMedia);
          const mtype = outboundMedia.type as 'image' | 'video' | 'document' | 'audio';
          await sendMedia(chatId, mtype, outboundMedia.url, caption);
        }
        context.lastRequestedMediaType = null;
      } catch (err) {
        logger.error({ err }, '[lead.flow] Failed to send media');
        replyText = 'Não consegui enviar agora. Pode tentar de novo em instantes?';
      }
    }

    // 16. Send text reply
    if (replyText) {
      await sendText(chatId, replyText);
    }
  } catch (err) {
    logger.error({ err }, '[lead.flow] Unhandled error');
  }
}
