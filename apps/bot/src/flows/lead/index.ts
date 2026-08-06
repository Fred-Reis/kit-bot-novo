// Port of flows/lead_flow.py

import { extractLeadUpdate } from '@/agents/lead';
import { runLeadAgentV2 } from '@/agents/lead-v2';
import { buildLeadTools } from '@/agents/tools';
import type { MediaItem } from '@/buffer';
import { prisma } from '@/db/client';
import { getChecklistForLead } from '@/flows/lead/checklist';
import { buildLeadSnapshot, type LeadContext, renderLeadContext } from '@/flows/lead/context';
import { buildTransparencyReply, handleDocumentIntake } from '@/flows/lead/doc-intake';
import { detectFrustration, escalateToHuman, isSameReply } from '@/flows/lead/escalation';
import {
  detectDocContestation,
  getSimpleGreetingReply,
  normalizeIntentText,
  resolveVisitedProperty,
} from '@/flows/lead/intents';
import {
  shouldResetDataConfirmation,
  shouldTransitionToKyc,
  shouldUpdateLeadSource,
} from '@/flows/lead/kyc';
import {
  findPropertyMedia,
  getRequestedMediaType,
  mediaCaption,
  shouldClearRequestedMediaType,
  shouldSendMediaDeterministically,
} from '@/flows/lead/media';
import { fsmStateToLeadStage } from '@/flows/lead/stage-map';
import { logger } from '@/lib/logger';
import {
  findMatchingProperty,
  getPropertyByExternalId,
  listAvailableProperties,
  summarizeProperty,
} from '@/services/catalog';
import {
  createSignedContractUrl,
  finalizeContractSigning,
  uploadSignedContractPdf,
} from '@/services/contract-signing';
import { extractCpfFromDocs } from '@/services/cpf';
import { sendMedia, sendText } from '@/services/evolution';
import { notifyOwner } from '@/services/notify';
import { createLeadDocumentUrl } from '@/services/storage';

const CHAT_HISTORY_LIMIT = 10;

const CONFIRMATION_WORDS = [
  'sim',
  'correto',
  'certo',
  'ok',
  'isso',
  'exato',
  'perfeito',
  'confirmo',
  'pode',
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

  try {
    // 1. Load lead + conversation
    const lead = await prisma.lead.findUnique({ where: { phone: chatId } });
    if (!lead) {
      logger.error({ chatId }, '[lead.flow] No lead record');
      return;
    }
    if (lead.archivedAt) {
      // Already converted (or manually archived) — the router's tenant lookup
      // should have already routed this phone to the tenant flow, but a
      // message that was mid-flight in a separate buffer flush when the
      // conversion committed can still land here. Drop it rather than run
      // the full lead agent against a stage that no longer applies (it has
      // no branch for 'converted' and falls through to a generic reply).
      logger.info({ chatId }, '[lead.flow] Lead already archived — skipping');
      return;
    }

    const context = await loadOrCreateConversation(chatId);
    const chatHistory = await loadChatHistory(chatId);

    // O banco manda no total de moradores: a tool registrar_moradores e o painel
    // escrevem lá, não no contexto. Sem este seed (incondicional, inclusive
    // null), um valor velho preso na sessão voltava a alimentar o extrator e a
    // ser regravado por cima do valor correto.
    context.expectedResidents = lead.expectedResidents ?? null;

    // Mesma doutrina pro flag de confirmação de dados: rollback manual de stage
    // pelo painel (kyc_pending -> collection, por exemplo) não limpa
    // Conversation.data, então sem isto a próxima mensagem do lead recalculava
    // shouldTransitionToKyc como true de novo e voltava o stage sozinho.
    if (shouldResetDataConfirmation(lead.stage)) {
      context.dataConfirmed = false;
      context.dataConfirmationSent = false;
    }

    // 2. Reset per-turn transient flags
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

    // O que o lead informou NESTE turno. Fica undefined quando a extração não
    // rodou (turno só de mídia/áudio) ou falhou — nesses casos o banco não é
    // tocado, em vez de reescrito com um valor antigo do contexto.
    let extractedExpectedResidents: number | null | undefined;

    if (messageText) {
      const availableProps = await listAvailableProperties();
      const availableSummary = availableProps.map((p) => summarizeProperty(p)).join('\n');
      const previousVisitedProperty = context.visitedProperty;
      const lastAssistantMessage =
        [...chatHistory].reverse().find((m) => m.role === 'assistant')?.content ?? null;
      const { extractedSource, ...updates } = await extractLeadUpdate(
        messageText,
        context,
        availableSummary,
        lastAssistantMessage,
      );
      extractedExpectedResidents = updates.expectedResidents;
      Object.assign(context, updates);

      context.visitedProperty = resolveVisitedProperty(
        previousVisitedProperty,
        context.visitedProperty,
        messageText,
      );

      // Don't overwrite manual source corrections made in the admin panel
      if (shouldUpdateLeadSource(lead.source, extractedSource)) {
        leadPatch.source = extractedSource;
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

    // 6b. Signed contract PDF detection — deterministic, before LLM
    // If lead is in contract_pending and sends a PDF, treat it as the signed contract.
    if (lead.stage === 'contract_pending') {
      const pdfItem = mediaItems.find(
        (item) => item.mime === 'application/pdf' && (item.base64 || item.url),
      );
      if (pdfItem) {
        const contract = await prisma.contract.findFirst({
          where: { leadId: lead.id, status: 'draft' },
          orderBy: { createdAt: 'desc' },
          select: { id: true, code: true },
        });
        if (contract) {
          // Ensure we have a persisted storage URL (in the 'contracts' bucket) before finalizing
          let signedPdfUrl: string | undefined;
          let base64: string | undefined = pdfItem.base64;
          if (!base64 && pdfItem.url) {
            // The buffer already uploaded this PDF to the 'leads' bucket (see
            // buffer.ts's bufferMedia) and only kept that storage path — fetch
            // it back so it can be re-uploaded into the 'contracts' bucket,
            // where the admin panel and finalizeContractSigning expect it.
            try {
              const downloadUrl = await createLeadDocumentUrl(pdfItem.url);
              const resp = await fetch(downloadUrl, { signal: AbortSignal.timeout(10_000) });
              if (!resp.ok) throw new Error(`download failed: ${resp.status}`);
              base64 = Buffer.from(await resp.arrayBuffer()).toString('base64');
            } catch (downloadErr) {
              logger.warn(
                { err: downloadErr },
                '[lead.flow] Failed to download signed contract PDF from leads bucket',
              );
            }
          }
          if (base64) {
            try {
              signedPdfUrl = await uploadSignedContractPdf(
                contract.id,
                base64,
                `${contract.code}-assinado.pdf`,
              );
            } catch (uploadErr) {
              logger.warn({ err: uploadErr }, '[lead.flow] Failed to upload signed contract PDF');
            }
          }

          // Only proceed if we have a storage URL
          if (!signedPdfUrl) {
            logger.error('[lead.flow] No signed PDF URL available — cannot finalize contract');
            await sendText(
              chatId,
              'Não foi possível processar o contrato. Por favor, tente enviar novamente.',
            );
            return;
          }

          try {
            await finalizeContractSigning({
              leadId: lead.id,
              contractId: contract.id,
              actorLabel: 'bot',
              signedPdfUrl,
            });
          } catch (finalizeErr) {
            logger.error({ err: finalizeErr }, '[lead.flow] finalizeContractSigning failed');
            await sendText(
              chatId,
              'Ocorreu um erro ao processar seu contrato. Nossa equipe foi notificada e entrará em contato.',
            );
            return;
          }

          const confirmationCaption =
            'Contrato recebido e assinado! ✅ Sua locação está confirmada. Aqui está sua cópia.';
          try {
            const signedUrl = await createSignedContractUrl(signedPdfUrl);
            await sendMedia(chatId, 'document', signedUrl, confirmationCaption);
          } catch (sendErr) {
            logger.warn({ err: sendErr }, '[lead.flow] Failed to send signed contract copy back');
            await sendText(
              chatId,
              'Contrato recebido e assinado! ✅ Sua locação está confirmada. Em breve entraremos em contato para alinhar os próximos passos.',
            );
          }
          return;
        }
      }

      // Lead in contract_pending sent text with "contrato assinado" but no PDF
      const normalizedText = normalizeIntentText(messageText);
      if (
        normalizedText.includes('contrato assinado') ||
        normalizedText.includes('assinei o contrato') ||
        normalizedText.includes('ja assinei')
      ) {
        await sendText(
          chatId,
          'Ótimo! Por favor, envie o contrato assinado aqui no WhatsApp como arquivo PDF. 📎',
        );
        return;
      }
    }

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

      // Check if checklist just completed → proactively send data confirmation
      const postIntakeSnapshot = await buildLeadSnapshot(
        lead.id,
        context,
        lead.scheduledVisitAt,
        lead.stage,
      );
      if (postIntakeSnapshot.state === 'lead.data_confirmation' && !context.dataConfirmationSent) {
        await persistConversation(chatId, context, null, intake.reply, ownerId);

        const docs = await loadLeadDocuments(lead.id);
        const cpf = extractCpfFromDocs(docs);
        context.lastRoutedAgent = 'deterministic_data_confirmation';

        const confirmMsg = cpf
          ? 'Por favor, confirme seus dados:\n\n' +
            `Nome: ${context.name ?? lead.name ?? 'não informado'}\n` +
            `CPF: ${cpf}\n\n` +
            'Está correto? Responda *sim* para confirmar ou *não* para corrigir.'
          : 'Não consegui ler o CPF no documento. Pode enviar uma foto mais nítida, com boa iluminação e sem reflexo?';

        if (cpf) context.dataConfirmationSent = true;

        const mappedStage = fsmStateToLeadStage('lead.data_confirmation', lead.stage);
        if (mappedStage && mappedStage !== lead.stage) {
          await prisma.lead.update({ where: { phone: chatId }, data: { stage: mappedStage } });
        }

        await persistConversation(chatId, context, null, confirmMsg, ownerId);
        await sendText(chatId, confirmMsg);
        return;
      }

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
      if (resolved && resolved.active && resolved.status === 'available') {
        context.propertyReference = resolved.externalId;
        context.propertyTitle = resolved.name;
        context.propertyReferenceLocked = true;
      } else {
        // Not just "don't re-lock": actively clear a stale reference. Without
        // this, a property that flips available → rented after being locked
        // in an earlier turn leaves context.propertyReference/Title stale, and
        // the visitedProperty branch below (line ~426) re-derives
        // propertyReferenceLocked from truthiness of that stale string alone —
        // reactivating the lock on an unavailable property every subsequent turn.
        context.propertyReference = null;
        context.propertyTitle = null;
        context.propertyReferenceLocked = false;
      }
    } else if (propertyInterest) {
      const matched = await findMatchingProperty(propertyInterest);
      if (matched) {
        context.propertyReference = matched.externalId;
        context.propertyTitle = matched.name;
        context.propertyReferenceLocked = true;
      }
    }

    if (context.visitedProperty === true) {
      context.propertyReferenceLocked = !!(context.propertyReference ?? '');
    }

    // 10. Build snapshot → derive state
    const snapshot = await buildLeadSnapshot(
      lead.id,
      context,
      lead.scheduledVisitAt,
      lead.stage,
    );

    if (snapshot.propertyInFocus?.id && snapshot.propertyInFocus.id !== lead.propertyId) {
      leadPatch.propertyId = snapshot.propertyInFocus.id;
    }

    // Persistir nome extraído pelo LLM
    if (context.name && context.name !== lead.name) {
      leadPatch.name = context.name;
    }

    // Quantidade esperada de moradores: só grava o que o lead informou NESTE
    // turno. Usar context.expectedResidents (acumulador que nunca era limpo)
    // revertia no turno seguinte o total que a tool registrar_moradores tinha
    // acabado de gravar.
    if (
      extractedExpectedResidents != null &&
      extractedExpectedResidents !== lead.expectedResidents
    ) {
      leadPatch.expectedResidents = extractedExpectedResidents;
    }

    // A tabela leadResident tem um único writer: a tool registrar_moradores.
    // Existia aqui um replace-all alimentado por context.residents — um
    // acumulador de sessão que nunca era limpo — rodando a cada turno. Como o
    // extrator só enxerga a mensagem atual, ele produz listas PARCIAIS, enquanto
    // a tool tem o histórico e o contrato de mandar a lista completa. O
    // replace-all fazia a lista parcial vencer: um morador citado em outra
    // mensagem era apagado do banco no turno seguinte, silenciosamente.

    // Sincronizar Lead.stage com o estado da conversa
    const mappedStage = fsmStateToLeadStage(snapshot.state, lead.stage);
    if (mappedStage && mappedStage !== lead.stage) {
      leadPatch.stage = mappedStage;
    }

    const kycTransition = shouldTransitionToKyc(
      snapshot.checklist.complete,
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

    // Data confirmation gate — deterministic flow, always returns early
    if (snapshot.state === 'lead.data_confirmation') {
      const replyDC = async (msg: string): Promise<void> => {
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

    if (shouldClearRequestedMediaType(requestedMediaType, outboundMedia)) {
      context.lastRequestedMediaType = null;
    }

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
    let targetAgent: string = 'lead_v2';
    if (!bypassAgentReply) {
      const tools = buildLeadTools({
        chatId,
        leadId: lead.id,
        ownerId: lead.ownerId,
        leadName: lead.name,
        propertyExternalId: snapshot.propertyInFocus?.externalId ?? null,
      });
      try {
        replyText = await runLeadAgentV2(question, leadContextStr, chatHistory, tools);
      } catch (err) {
        logger.error({ err }, '[lead.flow] runLeadAgentV2 failed');
        replyText = 'Desculpe, tive um problema para processar sua mensagem. Pode tentar de novo?';
      }

      // Se o agente escalou, o bot foi pausado e o sistema já avisou o lead
      const conv = await prisma.conversation.findUnique({ where: { chatId } });
      if (conv?.botPaused) {
        await persistConversation(chatId, context, messageText || null, null, ownerId);
        return;
      }
    } else {
      targetAgent = 'deterministic_media';
    }

    // 14. Detect loop before persisting — prevents ghost response in history
    if (replyText && !bypassAgentReply) {
      const lastAssistant = [...chatHistory].reverse().find((m) => m.role === 'assistant');
      if (isSameReply(replyText, lastAssistant?.content ?? null)) {
        await escalateToHuman(chatId, lead.ownerId, lead.name, 'loop');
        context.lastUserMessage = messageText;
        context.lastRoutedAgent = targetAgent;
        await persistConversation(chatId, context, messageText || null, null, ownerId);
        return;
      }
    }

    // 15. Persist conversation state + events
    context.lastUserMessage = messageText;
    context.lastRoutedAgent = targetAgent;

    await persistConversation(chatId, context, messageText || null, replyText, ownerId);

    // 16. Send outbound media or listing link
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

    // 17. Send text reply
    if (replyText) {
      await sendText(chatId, replyText);
    }
  } catch (err) {
    logger.error({ err }, '[lead.flow] Unhandled error');
  }
}
