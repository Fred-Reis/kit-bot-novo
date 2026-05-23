# Spec: Imóveis (`/properties`)

> Tracks only what is missing or broken vs the target design.

---

## UI Gaps

### Header
- Add **Filtros** button (stub → toast "Em breve")
- "Grade/Lista" toggle: replace Segmented with icon buttons (grid icon / list icon)

### Filter Tabs
- Design uses pill-style tabs with inline count; current implementation uses plain buttons — align styling
- Tab "Alugado" maps to `status === 'rented'` — confirm enum value matches DB

### Property Card (grid)
- Show **external ID** (`IM-0421`) above property name in muted mono
- Address format: "R. Oscar Freire, 1920 — Jardins, SP" (street + number — neighborhood, state)
- Photo fills full card top with rounded-t corners; hatched SVG placeholder when no media
- Status pill overlaid top-left on photo (not below it)
- Show area (m²) alongside bedroom/bathroom icons once schema column exists

### Property Card (row)
- Missing: external ID, neighborhood, area (m²)

---

## Missing Features

- Filtros drawer: filter by rent range, rooms, neighborhood (future)
- Sort options: by price, by date added (future)
- Bulk select + activate/deactivate (future)

---

## Backend Requirements

### Schema
- Add `area float` column to `properties` table (m² — currently absent)
- `externalId` already exists — enforce `IM-{sequence}` format on create if blank

### Queries (`lib/queries.ts`)
- Add `area` to `fetchProperties()` select projection once column exists
- Verify `status` enum values match filter keys exactly: `available | rented | maintenance | reserved`

### Bot API (`apps/bot`)
- Add `area` to `PROPERTY_PATCH_FIELDS` allowlist (`admin.ts`)
- Accept `area` in `POST /admin/properties` body
