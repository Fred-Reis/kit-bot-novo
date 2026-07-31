import type { Complaint, ComplaintStatus, MaintenanceRequest, MaintenanceStatus } from '@kit-manager/types';
import type { ComponentProps } from 'react';
import { twMerge } from 'tailwind-merge';
import { Pill } from '@/components/ui/pill';
import { SERVICE_TYPE_LABEL } from '@/lib/service-type-labels';

const COMPLAINT_STATUS_TONE: Record<ComplaintStatus, 'warn' | 'accent' | 'ok'> = {
  open: 'warn',
  acknowledged: 'accent',
  resolved: 'ok',
};
const COMPLAINT_STATUS_LABEL: Record<ComplaintStatus, string> = {
  open: 'Aberta',
  acknowledged: 'Reconhecida',
  resolved: 'Resolvida',
};
const COMPLAINT_NEXT_STATUS: Record<ComplaintStatus, ComplaintStatus | null> = {
  open: 'acknowledged',
  acknowledged: 'resolved',
  resolved: null,
};

const MAINTENANCE_STATUS_TONE: Record<MaintenanceStatus, 'warn' | 'accent' | 'ok'> = {
  open: 'warn',
  acknowledged: 'accent',
  in_progress: 'accent',
  resolved: 'ok',
};
const MAINTENANCE_STATUS_LABEL: Record<MaintenanceStatus, string> = {
  open: 'Aberto',
  acknowledged: 'Reconhecido',
  in_progress: 'Em andamento',
  resolved: 'Resolvido',
};
const MAINTENANCE_NEXT_STATUS: Record<MaintenanceStatus, MaintenanceStatus | null> = {
  open: 'acknowledged',
  acknowledged: 'in_progress',
  in_progress: 'resolved',
  resolved: null,
};

const dateFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp']);

// mediaUrls comes from the bot's media pipeline, which accepts any non-audio
// attachment (photo, video, or document) as chamado evidence — not just
// photos. Signed URLs carry a query string, so the extension check strips it
// first; anything that isn't a recognized image extension renders as a file
// link instead of an <img>, which would otherwise show a broken-image icon.
function isImageUrl(url: string): boolean {
  const path = url.split('?')[0] ?? '';
  const ext = path.split('.').pop()?.toLowerCase();
  return !!ext && IMAGE_EXTENSIONS.has(ext);
}

type UnifiedItem =
  | { kind: 'complaint'; createdAt: string; data: Complaint }
  | { kind: 'maintenance'; createdAt: string; data: MaintenanceRequest };

interface ComplaintsSectionProps extends Omit<ComponentProps<'div'>, 'children'> {
  complaints: Complaint[];
  maintenanceRequests: MaintenanceRequest[];
  isLoading: boolean;
  isAdvancing: boolean;
  onAdvanceStatus: (id: string, status: ComplaintStatus) => void;
  onAdvanceMaintenanceStatus: (id: string, status: MaintenanceStatus) => void;
}

export function ComplaintsSection({
  complaints,
  maintenanceRequests,
  isLoading,
  isAdvancing,
  onAdvanceStatus,
  onAdvanceMaintenanceStatus,
  className,
  ...props
}: ComplaintsSectionProps) {
  if (!isLoading && complaints.length === 0 && maintenanceRequests.length === 0) return null;

  const items: UnifiedItem[] = [
    ...complaints.map((c): UnifiedItem => ({ kind: 'complaint', createdAt: c.createdAt, data: c })),
    ...maintenanceRequests.map((m): UnifiedItem => ({ kind: 'maintenance', createdAt: m.createdAt, data: m })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <div
      data-slot="complaints-section"
      data-state={isLoading ? 'loading' : 'ready'}
      className={twMerge('rounded-xl border border-border bg-surface-raised p-5', className)}
      {...props}
    >
      <h2 className="mb-4 text-sm font-medium text-foreground">Chamados & Reclamações</h2>
      {isLoading ? (
        <div className="space-y-2">
          <div className="h-14 animate-pulse rounded-lg bg-muted" />
          <div className="h-14 animate-pulse rounded-lg bg-muted" />
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) =>
            item.kind === 'complaint' ? (
              <ComplaintRow
                key={item.data.id}
                complaint={item.data}
                isAdvancing={isAdvancing}
                onAdvanceStatus={onAdvanceStatus}
              />
            ) : (
              <MaintenanceRow
                key={item.data.id}
                request={item.data}
                isAdvancing={isAdvancing}
                onAdvanceStatus={onAdvanceMaintenanceStatus}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}

function ComplaintRow({
  complaint,
  isAdvancing,
  onAdvanceStatus,
}: {
  complaint: Complaint;
  isAdvancing: boolean;
  onAdvanceStatus: (id: string, status: ComplaintStatus) => void;
}) {
  const next = COMPLAINT_NEXT_STATUS[complaint.status];
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-foreground">{complaint.summary}</p>
        <Pill tone={COMPLAINT_STATUS_TONE[complaint.status]} dot>
          {COMPLAINT_STATUS_LABEL[complaint.status]}
        </Pill>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{complaint.content}</p>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{dateFmt.format(new Date(complaint.createdAt))}</span>
        {next && (
          <button
            type="button"
            onClick={() => onAdvanceStatus(complaint.id, next)}
            disabled={isAdvancing}
            className="text-xs font-medium text-accent-ink hover:underline disabled:opacity-50"
          >
            Marcar como {COMPLAINT_STATUS_LABEL[next].toLowerCase()}
          </button>
        )}
      </div>
    </div>
  );
}

function MaintenanceRow({
  request,
  isAdvancing,
  onAdvanceStatus,
}: {
  request: MaintenanceRequest;
  isAdvancing: boolean;
  onAdvanceStatus: (id: string, status: MaintenanceStatus) => void;
}) {
  const next = MAINTENANCE_NEXT_STATUS[request.status];
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-foreground">{request.summary}</p>
        <Pill tone={MAINTENANCE_STATUS_TONE[request.status]} dot>
          {MAINTENANCE_STATUS_LABEL[request.status]}
        </Pill>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {SERVICE_TYPE_LABEL[request.type] ?? request.type} · severidade {request.severity} · responsabilidade{' '}
        {request.responsibility}
      </p>
      {request.mediaUrls.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {request.mediaUrls.map((url, i) =>
            isImageUrl(url) ? (
              <a key={url} href={url} target="_blank" rel="noreferrer">
                <img
                  src={url}
                  alt={`Foto ${i + 1} do chamado`}
                  className="size-16 rounded-md object-cover"
                />
              </a>
            ) : (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noreferrer"
                className="flex h-16 items-center rounded-md border border-border px-3 text-xs font-medium text-accent-ink hover:underline"
              >
                Ver arquivo
              </a>
            ),
          )}
        </div>
      )}
      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{dateFmt.format(new Date(request.createdAt))}</span>
        {next && (
          <button
            type="button"
            onClick={() => onAdvanceStatus(request.id, next)}
            disabled={isAdvancing}
            className="text-xs font-medium text-accent-ink hover:underline disabled:opacity-50"
          >
            Marcar como {MAINTENANCE_STATUS_LABEL[next].toLowerCase()}
          </button>
        )}
      </div>
    </div>
  );
}
