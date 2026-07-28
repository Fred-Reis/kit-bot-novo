import { getSimpleGreetingReply, normalizeIntentText } from '@/flows/lead/intents';

const EMERGENCY_TERMS = ['incendio', 'fogo', 'cheiro de gas', 'alagamento'];

export const EMERGENCY_REPLY =
  '🚨 Emergência registrada. Se houver risco à vida, ligue AGORA para o Corpo de Bombeiros (193) ' +
  'ou SAMU (192). Já avisei o proprietário imediatamente.';

export const AUDIO_FALLBACK_REPLY =
  'Ainda não consigo entender mensagens de áudio. Pode escrever, por favor?';

export function getTenantGreetingReply(
  message: string | null,
  tenantName: string | null,
): string | null {
  const base = getSimpleGreetingReply(message);
  if (!base) return null;

  const name = tenantName?.trim();
  if (!name) return base;

  // "Olá!" -> "Olá, Maria!" / "Bom dia!" -> "Bom dia, Maria!"
  return `${base.slice(0, -1)}, ${name}!`;
}

export function detectEmergency(message: string | null): boolean {
  const normalized = normalizeIntentText(message ?? '');
  if (!normalized) return false;
  return EMERGENCY_TERMS.some((t) => normalized.includes(t));
}
