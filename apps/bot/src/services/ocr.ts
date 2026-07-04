import { GoogleAuth } from 'google-auth-library';
import { config } from '@/config';
import { logger } from '@/lib/logger';

let _auth: GoogleAuth | null = null;

function getAuth(): GoogleAuth | null {
  if (!config.GOOGLE_CREDENTIALS_JSON) return null;
  if (_auth) return _auth;

  try {
    const credentials = JSON.parse(config.GOOGLE_CREDENTIALS_JSON) as object;
    _auth = new GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/cloud-vision'],
    });
    return _auth;
  } catch (err) {
    logger.warn({ err }, '[ocr] Failed to parse GOOGLE_CREDENTIALS_JSON');
    return null;
  }
}

type VisionImage = { source: { imageUri: string } } | { content: string };

async function annotate(image: VisionImage): Promise<string> {
  const auth = getAuth();
  if (!auth) return '';
  try {
    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();
    const token = tokenResponse.token;
    if (!token) return '';
    const response = await fetch('https://vision.googleapis.com/v1/images:annotate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{ image, features: [{ type: 'TEXT_DETECTION', maxResults: 1 }] }],
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      logger.warn({ status: response.status, body }, '[ocr] Vision API error');
      return '';
    }
    const result = (await response.json()) as {
      responses?: Array<{ fullTextAnnotation?: { text?: string } }>;
    };
    return result.responses?.[0]?.fullTextAnnotation?.text ?? '';
  } catch (err) {
    logger.warn({ err }, '[ocr] annotate error');
    return '';
  }
}

export async function extractTextFromImage(imageUrl: string): Promise<string> {
  return annotate({ source: { imageUri: imageUrl } });
}

export async function extractTextFromBase64(base64: string): Promise<string> {
  return annotate({ content: base64 });
}
