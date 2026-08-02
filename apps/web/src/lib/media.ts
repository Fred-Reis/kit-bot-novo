const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp']);

// mediaUrls comes from the bot's media pipeline, which accepts any non-audio
// attachment (photo, video, or document) as chamado evidence — not just
// photos. Signed URLs carry a query string, so the extension check strips it
// first; anything that isn't a recognized image extension renders as a file
// link instead of an <img>, which would otherwise show a broken-image icon.
export function isImageUrl(url: string): boolean {
  const path = url.split('?')[0] ?? '';
  const ext = path.split('.').pop()?.toLowerCase();
  return !!ext && IMAGE_EXTENSIONS.has(ext);
}
