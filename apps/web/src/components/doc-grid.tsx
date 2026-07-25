import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Select } from '@/components/ui/select';

export interface DocItem {
  id: string;
  type: string;
  url: string;
  ocrText: string | null;
}

export interface ReclassifyOption {
  value: string;
  label: string;
}

export interface ReclassifyConfig {
  options: ReclassifyOption[];
  onSubmit: (docId: string, type: string) => void;
  pending?: boolean;
}

function DocViewerModal({
  doc,
  onClose,
  reclassify,
}: {
  doc: DocItem;
  onClose: () => void;
  reclassify?: ReclassifyConfig;
}) {
  const [selectedType, setSelectedType] = useState(doc.type);
  const [imgError, setImgError] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  // doc is re-derived from the live docs list (see DocGrid) by id, so once a
  // reclassify succeeds and the query refetches, doc.type changes under us —
  // keep the select in sync instead of showing the value from when the modal
  // first opened.
  useEffect(() => {
    setSelectedType(doc.type);
  }, [doc.type]);

  useEffect(() => {
    closeRef.current?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      data-slot="doc-viewer-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Documento: ${doc.type}`}
    >
      <div
        className="relative flex max-h-[90vh] max-w-3xl w-full flex-col items-center"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          ref={closeRef}
          type="button"
          aria-label="Fechar"
          onClick={onClose}
          className="mb-3 self-end rounded-full p-1 text-white/70 transition-colors hover:text-white"
        >
          <X className="size-6" />
        </button>
        {imgError ? (
          <a
            href={doc.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex max-h-[80vh] w-full flex-col items-center justify-center gap-2 rounded-lg bg-surface-raised p-8 text-sm text-foreground-subtle shadow-xl"
          >
            Não foi possível exibir a prévia. Abrir arquivo em nova aba →
          </a>
        ) : (
          <img
            src={doc.url}
            alt={doc.type}
            onError={() => setImgError(true)}
            className="max-h-[80vh] w-full rounded-lg object-contain shadow-xl"
          />
        )}
        <p className="mt-3 text-xs font-medium uppercase tracking-wide text-white/60">{doc.type}</p>
        {reclassify && (
          <div className="mt-3 flex w-full max-w-xs items-center gap-2" onClick={(e) => e.stopPropagation()}>
            <Select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              disabled={reclassify.pending}
              aria-label="Reclassificar documento"
            >
              {reclassify.options.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
            <button
              type="button"
              disabled={reclassify.pending || selectedType === doc.type}
              onClick={() => reclassify.onSubmit(doc.id, selectedType)}
              className="shrink-0 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              Salvar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function DocCard({ doc, onSelect }: { doc: DocItem; onSelect: () => void }) {
  const [imgError, setImgError] = useState(false);

  return (
    <button
      type="button"
      data-slot="doc-card"
      onClick={onSelect}
      className="overflow-hidden rounded-lg border border-border bg-surface text-left transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex h-36 items-center justify-center overflow-hidden bg-muted">
        {imgError ? (
          <span className="px-2 text-center text-xs text-muted-foreground">Sem prévia</span>
        ) : (
          <img
            src={doc.url}
            alt={doc.type}
            onError={() => setImgError(true)}
            className="h-full w-full object-contain"
          />
        )}
      </div>
      <div className="p-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {doc.type}
        </p>
        {doc.ocrText && (
          <p className="mt-1 line-clamp-2 text-xs text-foreground-subtle">{doc.ocrText}</p>
        )}
      </div>
    </button>
  );
}

export function DocGrid({ docs, reclassify }: { docs: DocItem[]; reclassify?: ReclassifyConfig }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Re-derive from the live docs prop (rather than storing the DocItem
  // snapshot itself) so a reclassify that changes doc.type is reflected in
  // the still-open modal once the query refetches.
  const selected = selectedId ? (docs.find((d) => d.id === selectedId) ?? null) : null;

  if (docs.length === 0)
    return <p className="text-sm text-muted-foreground">Nenhum documento enviado.</p>;

  return (
    <>
      <div data-slot="doc-grid" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {docs.map((doc) => (
          <DocCard key={doc.id} doc={doc} onSelect={() => setSelectedId(doc.id)} />
        ))}
      </div>
      {selected && (
        <DocViewerModal doc={selected} onClose={() => setSelectedId(null)} reclassify={reclassify} />
      )}
    </>
  );
}
