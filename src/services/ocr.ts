import { GoogleAuth } from 'google-auth-library';
import { config } from '@/config';

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
  } catch {
    console.warn('[ocr] Failed to parse GOOGLE_CREDENTIALS_JSON');
    return null;
  }
}

export async function extractTextFromImage(imageUrl: string): Promise<string> {
  const auth = getAuth();
  if (!auth) return '';

  try {
    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();
    const token = tokenResponse.token;
    if (!token) return '';

    const response = await fetch('https://vision.googleapis.com/v1/images:annotate', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requests: [
          {
            image: { source: { imageUri: imageUrl } },
            features: [{ type: 'TEXT_DETECTION', maxResults: 1 }],
          },
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.warn(`[ocr] Vision API error: ${response.status} ${body}`);
      return '';
    }

    const result = (await response.json()) as {
      responses?: Array<{ fullTextAnnotation?: { text?: string } }>;
    };

    return result.responses?.[0]?.fullTextAnnotation?.text ?? '';
  } catch (err) {
    console.warn('[ocr] extractTextFromImage error:', err);
    return '';
  }
}
