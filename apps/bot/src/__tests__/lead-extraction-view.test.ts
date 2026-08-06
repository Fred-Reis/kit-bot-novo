import { describe, expect, it } from 'bun:test';
import { buildExtractionView } from '@/agents/lead';
import type { LeadContext } from '@/flows/lead/context';

// Contexto igual ao persistido no incidente do smoke test: campos duráveis
// misturados com sobras de sessão travadas de turnos antigos. Tipado como o
// JSON cru de Conversation.data porque é isso que chega em produção — inclui
// `visitRequested`, chave que já saiu do LeadContext mas segue gravada no banco.
const incidentContext = {
  state: 'lead.visit_scheduling',
  currentIntent: 'visit',
  visitRequested: true,
  lastUserMessage: 'Vai marcar a visita?',
  lastRoutedAgent: 'lead_v2',
  lastRequestedMediaType: 'video',
  docsPreference: 'cnh',
  residentsComplete: false,
  analysisSubmitted: false,
  docsContestations: 1,
  wantsSchedule: false,
  wantsHuman: false,
  audioReceived: false,
  name: 'Aline',
  propertyReference: 'KIT-06',
  propertyTitle: 'Kitnet no Retiro – Unid. 04',
  propertyInterest: 'KIT-06',
  visitedProperty: false,
  expectedResidents: 1,
} as unknown as LeadContext;

describe('buildExtractionView', () => {
  const view = buildExtractionView(incidentContext) as Record<string, unknown>;

  it('preserva os fatos duraveis que o extrator precisa pra desambiguar', () => {
    expect(view.name).toBe('Aline');
    expect(view.propertyReference).toBe('KIT-06');
    expect(view.visitedProperty).toBe(false);
    expect(view.expectedResidents).toBe(1);
  });

  it('nao vaza estado derivado nem intencao do turno anterior', () => {
    // context.state fica congelado quando a escalação retorna cedo, e
    // currentIntent sobrevive a turnos sem extração — realimentar os dois no
    // extrator cria eco: ele confirma a própria classificação antiga.
    expect(view).not.toHaveProperty('state');
    expect(view).not.toHaveProperty('currentIntent');
  });

  it('nao vaza flags de sessao mortas nem telemetria', () => {
    for (const dead of [
      'visitRequested',
      'lastUserMessage',
      'lastRoutedAgent',
      'lastRequestedMediaType',
      'docsPreference',
      'residentsComplete',
      'docsContestations',
      'wantsSchedule',
      'wantsHuman',
      'audioReceived',
      'analysisSubmitted',
    ]) {
      expect(view).not.toHaveProperty(dead);
    }
  });

  it('omite chaves ausentes em vez de mandar null/undefined', () => {
    expect(buildExtractionView({})).toEqual({});
  });

  it('ignora chaves legadas que sobraram no Conversation.data de builds antigos', () => {
    const legacy = {
      visitConfirmationSent: true,
      campoQueNaoExisteMais: 'x',
    } as unknown as LeadContext;
    expect(buildExtractionView(legacy)).toEqual({});
  });
});
