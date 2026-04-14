import { config } from '@/config';

export async function extractTextFromImage(imageUrl: string): Promise<string> {
  if (!config.AZURE_VISION_ENDPOINT || !config.AZURE_VISION_KEY) {
    return '';
  }

  const endpoint = config.AZURE_VISION_ENDPOINT.replace(/\/$/, '');
  const url = `${endpoint}/computervision/imageanalysis:analyze?api-version=2024-02-01&features=read`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': config.AZURE_VISION_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: imageUrl }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.warn(`Azure Vision OCR failed: ${response.status} ${body}`);
      return '';
    }

    const result = (await response.json()) as {
      readResult?: { content?: string };
    };

    return result.readResult?.content ?? '';
  } catch (err) {
    console.warn('Azure Vision OCR error:', err);
    return '';
  }
}
