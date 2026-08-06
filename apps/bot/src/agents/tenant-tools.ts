import {
  MAINTENANCE_RESPONSIBILITIES,
  MAINTENANCE_SEVERITIES,
  type MaintenanceResponsibility,
  type MaintenanceSeverity,
  type MaintenanceType,
  SERVICE_CATEGORIES,
} from '@kit-manager/types';
import { type StructuredToolInterface, tool } from '@langchain/core/tools';
import { z } from 'zod';
import { prisma } from '@/db/client';
import { escalateTenantToOwner } from '@/flows/tenant/escalation';
import { logger } from '@/lib/logger';
import { logActivity } from '@/services/activity';
import { notifyOwner } from '@/services/notify';

export interface TenantToolDeps {
  chatId: string;
  tenantId: string;
  ownerId: string;
  tenantName: string | null;
  propertyId: string;
  pendingMediaUrls: string[];
}

function fail(msg: string): string {
  return `Erro: ${msg}`;
}

export function buildTenantTools(deps: TenantToolDeps): StructuredToolInterface[] {
  const escalarOwner = tool(
    async ({ motivo }: { motivo: string }) => {
      try {
        await escalateTenantToOwner(deps.chatId, deps.ownerId, deps.tenantId, deps.tenantName, 'out_of_scope', motivo);
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

  const registrarReclamacao = tool(
    async ({ resumo, conteudo }: { resumo: string; conteudo: string }) => {
      try {
        const complaint = await prisma.complaint.create({
          data: { ownerId: deps.ownerId, tenantId: deps.tenantId, summary: resumo, content: conteudo },
        });
        const displayName = deps.tenantName ?? deps.chatId;
        notifyOwner(deps.ownerId, 'tenant_complaint', {
          tenantName: displayName,
          tenantPhone: deps.chatId,
          summary: resumo,
        }).catch((err) => logger.error({ err }, '[tenant-tools] notifyOwner tenant_complaint falhou'));
        logActivity({
          ownerId: deps.ownerId,
          actorType: 'bot',
          actorLabel: 'Bot',
          action: 'complaint_registered',
          subjectType: 'complaint',
          subjectId: complaint.id,
          subject: displayName,
          metadata: { summary: resumo },
        }).catch((err) => logger.error({ err }, '[tenant-tools] logActivity complaint_registered falhou'));
        return 'Reclamação registrada com sucesso.';
      } catch (err) {
        logger.error({ err }, '[tenant-tools] registrar_reclamacao');
        return fail('não consegui registrar a reclamação agora.');
      }
    },
    {
      name: 'registrar_reclamacao',
      description:
        'Registra uma reclamação formal do inquilino (ex: barulho, problema recorrente não resolvido, ' +
        'insatisfação com atendimento). Cria registro no sistema e notifica o proprietário. ' +
        'resumo: uma linha curta. conteudo: o relato completo do inquilino, sem resumir ou inventar detalhes.',
      schema: z.object({ resumo: z.string(), conteudo: z.string() }),
    },
  );

  const abrirChamado = tool(
    async ({
      tipo,
      severidade,
      resumo,
      responsabilidade,
    }: {
      tipo: MaintenanceType;
      severidade: MaintenanceSeverity;
      resumo: string;
      responsabilidade: MaintenanceResponsibility;
    }) => {
      try {
        const request = await prisma.maintenanceRequest.create({
          data: {
            ownerId: deps.ownerId,
            tenantId: deps.tenantId,
            propertyId: deps.propertyId,
            type: tipo,
            severity: severidade,
            responsibility: responsabilidade,
            summary: resumo,
            mediaUrls: deps.pendingMediaUrls,
          },
        });
        const displayName = deps.tenantName ?? deps.chatId;
        if (responsabilidade !== 'tenant' || severidade === 'urgente') {
          notifyOwner(deps.ownerId, 'tenant_maintenance_request', {
            tenantName: displayName,
            tenantPhone: deps.chatId,
            summary: resumo,
            type: tipo,
            responsibility: responsabilidade,
            severity: severidade,
          }).catch((err) => logger.error({ err }, '[tenant-tools] notifyOwner tenant_maintenance_request falhou'));
        }
        logActivity({
          ownerId: deps.ownerId,
          actorType: 'bot',
          actorLabel: 'Bot',
          action: 'maintenance_request_created',
          subjectType: 'maintenance_request',
          subjectId: request.id,
          subject: displayName,
          metadata: { type: tipo, severity: severidade, responsibility: responsabilidade },
        }).catch((err) => logger.error({ err }, '[tenant-tools] logActivity maintenance_request_created falhou'));
        return 'Chamado registrado com sucesso.';
      } catch (err) {
        logger.error({ err }, '[tenant-tools] abrir_chamado');
        return fail('não consegui registrar o chamado agora.');
      }
    },
    {
      name: 'abrir_chamado',
      description:
        'Abre um chamado de manutenção. tipo: eletrica, hidraulica, civil ou limpeza_conservacao. ' +
        'severidade: baixa, media ou urgente (risco imediato ao imóvel/segurança, mas NÃO emergência de vida — ' +
        'isso já é tratado antes de você ser chamado). responsabilidade: use o resumo da Lei do Inquilinato ' +
        'e o contrato, já disponíveis no seu contexto, para decidir entre tenant (uso/desgaste do dia a dia), ' +
        'owner (estrutura, desgaste natural, vício do imóvel) ou unclear quando o relato não permitir distinguir — ' +
        'nunca decida um caso ambíguo como tenant só para simplificar.',
      schema: z.object({
        tipo: z.enum(SERVICE_CATEGORIES),
        severidade: z.enum(MAINTENANCE_SEVERITIES),
        resumo: z.string(),
        responsabilidade: z.enum(MAINTENANCE_RESPONSIBILITIES),
      }),
    },
  );

  const indicarProfissional = tool(
    async ({ tipo }: { tipo: MaintenanceType }) => {
      try {
        const provider = await prisma.serviceProvider.findFirst({
          where: { ownerId: deps.ownerId, type: tipo, active: true },
          orderBy: { createdAt: 'asc' },
        });
        if (!provider) {
          return 'Não há profissional cadastrado para esse tipo de serviço no momento.';
        }
        return `Profissional indicado: ${provider.name} — ${provider.phone}.`;
      } catch (err) {
        logger.error({ err }, '[tenant-tools] indicar_profissional');
        return fail('não consegui consultar os profissionais agora.');
      }
    },
    {
      name: 'indicar_profissional',
      description:
        'Indica um profissional cadastrado (eletricista, encanador, pedreiro, diarista) para o tipo de serviço. ' +
        'Use quando o problema for responsabilidade do inquilino (já deu a dica de resolver sozinho) ou o ' +
        'inquilino pedir uma indicação. Se não houver cadastrado, diga isso honestamente — nunca invente um nome.',
      schema: z.object({ tipo: z.enum(SERVICE_CATEGORIES) }),
    },
  );

  return [escalarOwner, registrarReclamacao, abrirChamado, indicarProfissional];
}
