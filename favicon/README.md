# Favicon — kit-manager

Ícone final: casa em traço contínuo (assimétrico) com a porta formada pelo fim da linha. Laranja `#C2410C` + ink `#231F1C`.

## Arquivos
- `favicon.svg` — favicon vetorial (tile escuro + marca). Use como principal.
- `favicon.ico` — 16/32/48px embutidos (compatibilidade legada).
- `favicon-16.png`, `-32.png`, `-48.png` — favicons raster.
- `apple-touch-icon.png` — 180px (iOS).
- `maskable-512.png` — 512px com padding seguro (PWA maskable).
- `favicon-512.png` — 512px (lojas/preview).
- `icon-mark.svg` — só a marca, fundo transparente, dois tons (ink + laranja). Para uso dentro do app sobre fundos claros.
- `icon-tile-light.svg` — tile claro (`#F1ECE6`) com a marca, alternativa.

## Como plugar (HTML `<head>`)
```html
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
```

## PWA (manifest.json)
```json
{
  "icons": [
    { "src": "/favicon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ],
  "theme_color": "#C2410C",
  "background_color": "#231F1C"
}
```

## Dentro do app (sidebar)
Troque o quadradinho de iniciais por `icon-mark.svg` (ou a versão tile) no `.side__logo`.
