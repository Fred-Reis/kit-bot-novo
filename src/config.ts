import { z } from 'zod';

const schema = z.object({
  // OpenAI
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL_NAME: z.string().default('gpt-4o-mini'),

  // Evolution API
  EVOLUTION_API_URL: z.string().url(),
  EVOLUTION_INSTANCE_NAME: z.string().min(1),
  EVOLUTION_API_KEY: z.string().min(1),

  // Database
  DATABASE_URL: z.string().url(),

  // Supabase Storage
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_KEY: z.string().min(1),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // Bot settings
  PORT: z.coerce.number().default(3000),
  DEBOUNCE_SECONDS: z.coerce.number().default(5),
  BUFFER_TTL_SECONDS: z.coerce.number().default(3600),
  LOG_PAYLOADS: z
    .string()
    .transform((v) => v === 'true' || v === '1')
    .default('false'),

  // Google Cloud Vision (OCR) — optional
  GOOGLE_CREDENTIALS_JSON: z.string().optional(),
});

export const config = schema.parse(process.env);
