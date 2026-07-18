import { Download, Eye, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { adminApi } from '@/lib/api';
import type { ContractDoc } from '@/lib/queries';
import { supabase } from '@/lib/supabase';

function storagePath(urlOrPath: string): string {
  try {
    const u = new URL(urlOrPath);
    const match = u.pathname.match(/\/object\/(?:public\/|sign\/|authenticated\/)?contracts\/(.+)/);
    if (match) return decodeURIComponent(match[1]);
  } catch {
    /* already a relative path */
  }
  return urlOrPath;
}

async function getSignedUrl(contractId: string, signedPdfPath?: string): Promise<string | null> {
  if (signedPdfPath) {
    const { data, error } = await supabase.storage
      .from('contracts')
      .createSignedUrl(storagePath(signedPdfPath), 300);
    return error ? null : (data?.signedUrl ?? null);
  }
  try {
    const { data } = await adminApi.getContractPdf(contractId);
    return data.url;
  } catch {
    return null;
  }
}

async function previewPdf(contractId: string, signedPdfPath?: string) {
  const tab = window.open('', '_blank');
  const signedUrl = await getSignedUrl(contractId, signedPdfPath);
  if (!signedUrl) {
    tab?.close();
    toast.error('Não foi possível abrir o arquivo.');
    return;
  }
  try {
    const resp = await fetch(signedUrl);
    if (!resp.ok) throw new Error();
    const blob = await resp.blob();
    const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
    if (tab) tab.location.href = url;
    else window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch {
    tab?.close();
    toast.error('Não foi possível abrir o arquivo.');
  }
}

async function downloadPdf(contractId: string, filename: string, signedPdfPath?: string) {
  const toastId = toast.loading('Baixando arquivo...');
  const signedUrl = await getSignedUrl(contractId, signedPdfPath);
  if (!signedUrl) {
    toast.error('Não foi possível baixar o arquivo.', { id: toastId });
    return;
  }
  try {
    const resp = await fetch(signedUrl);
    if (!resp.ok) throw new Error();
    const blob = await resp.blob();
    toast.dismiss(toastId);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch {
    toast.error('Não foi possível baixar o arquivo.', { id: toastId });
  }
}

export function ContractsSection({
  contracts,
  isLoading,
}: {
  contracts: ContractDoc[];
  isLoading: boolean;
}) {
  if (!isLoading && contracts.length === 0) return null;

  return (
    <div data-slot="contracts-section" className="rounded-xl border border-border bg-surface-raised p-5">
      <h2 className="mb-4 text-sm font-medium text-foreground">Contrato</h2>
      {isLoading ? (
        <div className="space-y-2">
          <div className="h-10 animate-pulse rounded-lg bg-muted" />
          <div className="h-10 animate-pulse rounded-lg bg-muted" />
        </div>
      ) : (
        <div className="space-y-3">
          {contracts.map((c) => (
            <div key={c.id} className="space-y-2">
              {c.pdfUrl && (
                <div className="flex w-full items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2.5">
                  <FileText className="size-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">{c.code}.pdf</p>
                    <p className="text-xs text-muted-foreground">Contrato emitido</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label="Visualizar contrato"
                      onClick={() => void previewPdf(c.id)}
                      className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <Eye className="size-4" />
                    </button>
                    <button
                      type="button"
                      aria-label="Baixar contrato"
                      onClick={() => void downloadPdf(c.id, `${c.code}.pdf`)}
                      className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <Download className="size-4" />
                    </button>
                  </div>
                </div>
              )}
              {c.signedPdfUrl ? (
                <div className="flex w-full items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2.5">
                  <FileText className="size-5 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">{c.code}-assinado.pdf</p>
                    <p className="text-xs text-muted-foreground">Contrato assinado</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label="Visualizar contrato assinado"
                      onClick={() => void previewPdf(c.id, c.signedPdfUrl!)}
                      className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <Eye className="size-4" />
                    </button>
                    <button
                      type="button"
                      aria-label="Baixar contrato assinado"
                      onClick={() => void downloadPdf(c.id, `${c.code}-assinado.pdf`, c.signedPdfUrl!)}
                      className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <Download className="size-4" />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 rounded-lg border border-dashed border-border px-3 py-2.5">
                  <FileText className="size-5 shrink-0 text-muted-foreground/40" />
                  <p className="text-xs text-muted-foreground">Aguardando contrato assinado</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
