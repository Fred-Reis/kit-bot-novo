// Port of flows/lead_flow.py
import type { MediaItem } from '@/buffer';
import { prisma } from '@/db/client';
import { sendText, sendMedia } from '@/services/evolution';
import { getPropertyByExternalId, findMatchingProperty, listAvailableProperties, summarizeProperty } from '@/services/catalog';
import { getSimpleGreetingReply } from '@/flows/lead/intents';
import { buildLeadSnapshot, renderLeadContext, type LeadContext } from '@/flows/lead/context';
import { resolveTargetAgent } from '@/flows/lead/rules';
import {
  getRequestedMediaType,
  findPropertyMedia,
  shouldSendMediaDeterministically,
  mediaCaption,
} from '@/flows/lead/media';
import { extractLeadUpdate, routeLeadMessage, runLeadAgent } from '@/agents/lead';

const CHAT_HISTORY_LIMIT = 10;

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
    .filter((e) => e.role === 'user' || e.role === 'assistant')
    .map((e) => ({ role: e.role as 'user' | 'assistant', content: e.content }));
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
): Promise<void> {
  const ops: Array<ReturnType<typeof prisma.event.create>> = [];

  if (userMessage) {
    ops.push(
      prisma.event.create({
        data: { chatId, role: 'user', content: userMessage },
      }),
    );
  }
  if (assistantReply) {
    ops.push(
      prisma.event.create({
        data: { chatId, role: 'assistant', content: assistantReply },
      }),
    );
  }

  await prisma.$transaction([
    prisma.conversation.upsert({
      where: { chatId },
      update: { data: context as object },
      create: { chatId, data: context as object },
    }),
    ...ops,
  ]);
}

async function persistLeadDocuments(
  leadId: string,
  mediaItems: MediaItem[],
  docsPreference: 'cnh' | 'rg_cpf' | null,
): Promise<void> {
  const docItems = mediaItems.filter((m) => !isAudioMedia(m) && m.url);
  if (docItems.length === 0) return;

  const docType = docsPreference ?? 'image';

  await prisma.leadDocument.createMany({
    data: docItems.map((m) => ({
      leadId,
      type: docType,
      url: m.url!,
    })),
  });
}

export async function handleLeadMessage(
  chatId: string,
  text: string | null,
  mediaItems: MediaItem[],
): Promise<void> {
  console.info(`[lead.flow] Message received for ${chatId}`);

  const messageText = text ?? '';
  let replyText: string | null = null;
  let bypassAgentReply = false;

  try {
    // 1. Load lead + conversation
    const lead = await prisma.lead.findUnique({ where: { phone: chatId } });
    if (!lead) {
      console.error(`[lead.flow] No lead record for ${chatId}`);
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
      await persistConversation(chatId, context, messageText, greetingReply);
      await sendText(chatId, greetingReply);
      return;
    }

    // 5. LLM extraction → merge into context (pass available properties so extractor can infer)
    if (messageText) {
      const availableProps = await listAvailableProperties();
      const availableSummary = availableProps.map((p) => summarizeProperty(p)).join('\n');
      const updates = await extractLeadUpdate(messageText, context, availableSummary);
      Object.assign(context, updates);
    }

    // 6. Handle audio flag
    const audioReceived = mediaItems.some(isAudioMedia);
    context.audioReceived = audioReceived;

    // 7. Persist document images
    await persistLeadDocuments(lead.id, mediaItems, context.docsPreference ?? null);

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
    if (context.visitedProperty === false && context.wantsSchedule && context.name) {
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

    await persistConversation(chatId, context, messageText || null, replyText);

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
        console.error('[lead.flow] Failed to send media:', err);
        replyText = 'Não consegui enviar agora. Pode tentar de novo em instantes?';
      }
    }

    // 16. Send text reply
    if (replyText) {
      await sendText(chatId, replyText);
    }
  } catch (err) {
    console.error('[lead.flow] Unhandled error:', err);
  }
}
