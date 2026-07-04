// Port of flows/lead_flow.py

import { extractLeadUpdate, routeLeadMessage, runLeadAgent } from '@/agents/lead';
import type { MediaItem } from '@/buffer';
import { prisma } from '@/db/client';
import { buildLeadSnapshot, type LeadContext, renderLeadContext } from '@/flows/lead/context';
import { buildTransparencyReply, handleDocumentIntake } from '@/flows/lead/doc-intake';
import { escalateToHuman, detectFrustration, isSameReply } from '@/flows/lead/escalation';
import { getSimpleGreetingReply, normalizeIntentText, detectDocContestation } from '@/flows/lead/intents';
import { getChecklistForLead } from '@/flows/lead/checklist';
import { parseIncomeValue } from '@/flows/lead/income';
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

const CHAT_HISTORY_LIMIT = 10;

const CONFIRMATION_WORDS = [
  'sim', 'correto', 'certo', 'ok', 'isso', 'exato', 'perfeito', 'confirmo', 'pode',
];

const REJECTION_WORDS = ['nao', 'errado', 'incorreto'];

function isAudioMedia(item: MediaItem): boolean {
  return (item.mime ?? '').startsWith('audio/') || (item.type ?? '').startsWith('audio');
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
  let visitCancelledThisTurn = false;

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
      const previousVisitedProperty = context.visitedProperty;
      const { extractedSource, scheduledVisitAt: extractedVisitAt, visitCancelled, ...updates } = await extractLeadUpdate(
        messageText,
        context,
        availableSummary,
      );
      Object.assign(context, updates);

      // visitedProperty is monotonic: once the lead has visited, it never reverts
      if (previousVisitedProperty === true && context.visitedProperty !== true) {
        context.visitedProperty = true;
      }

      // Don't overwrite manual source corrections made in the admin panel
      if (shouldUpdateLeadSource(lead.source, extractedSource)) {
        leadPatch.source = extractedSource;
      }

      if (visitCancelled) {
        leadPatch.scheduledVisitAt = null;
        context.wantsSchedule = false;
        context.visitRequested = false;
        visitCancelledThisTurn = true;
      } else if (extractedVisitAt) {
        // Persist confirmed visit date — only advance, never regress
        const proposedDate = new Date(extractedVisitAt);
        if (!isNaN(proposedDate.getTime()) && proposedDate > new Date()) {
          leadPatch.scheduledVisitAt = proposedDate;
        }
      }
    }

    // Escalação: pedido de humano ou frustração → pausa + notificação
    if (context.wantsHuman || detectFrustration(messageText)) {
      const reason = context.wantsHuman ? 'human_request' : 'frustration';
      await escalateToHuman(chatId, lead.ownerId, lead.name, reason);
      await persistConversation(chatId, context, messageText || null, null, ownerId);
      return;
    }

    // 6. Handle audio flag
    const audioReceived = mediaItems.some(isAudioMedia);
    context.audioReceived = audioReceived;

    // 7. Pipeline determinístico de documentos (zero LLM)
    const intake = await handleDocumentIntake(chatId, lead.id, ownerId, mediaItems);
    if (intake.reply) {
      await sendText(chatId, intake.reply);
    }
    if (intake.persisted.length > 0) {
      context.docsContestations = 0;
      if (context.dataConfirmed || context.dataConfirmationSent) {
        context.dataConfirmed = false;
        context.dataConfirmationSent = false;
      }
    }
    // Turno só de documento: a resposta determinística basta — não acionar LLM
    if (!messageText && intake.processed > 0) {
      context.lastUserMessage = '';
      context.lastRoutedAgent = 'deterministic_doc_intake';
      await persistConversation(chatId, context, null, intake.reply, ownerId);
      return;
    }

    // Contestação de documentos — transparência total, determinístico
    if (intake.processed === 0 && detectDocContestation(messageText)) {
      const checklist = await getChecklistForLead(lead.id);
      if (!checklist.identity.complete) {
        const count = (context.docsContestations ?? 0) + 1;
        context.docsContestations = count;

        if (count >= 2) {
          await escalateToHuman(chatId, lead.ownerId, lead.name, 'contestation');
          await persistConversation(chatId, context, messageText, null, ownerId);
          return;
        }

        const docs = await prisma.leadDocument.findMany({
          where: { leadId: lead.id },
          select: { type: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        });
        const reply = buildTransparencyReply(docs, checklist);
        context.lastUserMessage = messageText;
        context.lastRoutedAgent = 'deterministic_transparency';
        await persistConversation(chatId, context, messageText, reply, ownerId);
        await sendText(chatId, reply);
        return;
      }
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

    // Persistir renda declarada (valor numérico)
    const incomeValue = parseIncomeValue(context.income);
    if (incomeValue != null && Number(lead.declaredIncome ?? 0) !== incomeValue) {
      leadPatch.declaredIncome = incomeValue;
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
      const tz = 'America/Sao_Paulo';
      const dateStr = newVisitAt.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        timeZone: tz,
      });
      const timeStr = newVisitAt.toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: tz,
      });
      const propertyName = snapshot.propertyInFocus?.name ?? 'o imóvel';
      replyText = `✅ Visita confirmada! Aguardamos você no dia ${dateStr} às ${timeStr} no ${propertyName}. Qualquer dúvida, é só chamar!`;
      bypassAgentReply = true;
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
      const routedAgent = visitCancelledThisTurn
        ? 'scheduling'
        : await routeLeadMessage(question, leadContextStr);
      targetAgent = visitCancelledThisTurn
        ? 'scheduling'
        : resolveTargetAgent(snapshot.state, routedAgent);
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

    // 16. Send text reply — com detecção de loop
    if (replyText) {
      const lastAssistant = [...chatHistory].reverse().find((m) => m.role === 'assistant');
      if (!bypassAgentReply && isSameReply(replyText, lastAssistant?.content ?? null)) {
        await escalateToHuman(chatId, lead.ownerId, lead.name, 'loop');
        return;
      }
      await sendText(chatId, replyText);
    }
  } catch (err) {
    logger.error({ err }, '[lead.flow] Unhandled error');
  }
}
