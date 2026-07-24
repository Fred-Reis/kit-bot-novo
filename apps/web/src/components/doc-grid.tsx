import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
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

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
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
          type="button"
          aria-label="Fechar"
          onClick={onClose}
          className="mb-3 self-end rounded-full p-1 text-white/70 transition-colors hover:text-white"
        >
          <X className="size-6" />
        </button>
        <img
          src={doc.url}
          alt={doc.type}
          className="max-h-[80vh] w-full rounded-lg object-contain shadow-xl"
        />
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

export function DocGrid({ docs, reclassify }: { docs: DocItem[]; reclassify?: ReclassifyConfig }) {
  const [selected, setSelected] = useState<DocItem | null>(null);

  if (docs.length === 0)
    return <p className="text-sm text-muted-foreground">Nenhum documento enviado.</p>;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {docs.map((doc) => (
          <button
            key={doc.id}
            type="button"
            data-slot="doc-card"
            onClick={() => setSelected(doc)}
            className="overflow-hidden rounded-lg border border-border bg-surface text-left transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="flex h-36 items-center justify-center overflow-hidden bg-muted">
              <img src={doc.url} alt={doc.type} className="h-full w-full object-contain" />
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
        ))}
      </div>
      {selected && (
        <DocViewerModal doc={selected} onClose={() => setSelected(null)} reclassify={reclassify} />
      )}
    </>
  );
}
