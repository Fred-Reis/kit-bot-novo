import { createFileRoute } from '@tanstack/react-router';
import { useState, useRef, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { fetchContractTemplates, fetchContractTemplate } from '@/lib/queries';
import { adminApi } from '@/lib/api';
import { PageHeader } from '@/components/page-header';
import { CustomButton } from '@/components/ui/btn';
import { Pill } from '@/components/ui/pill';
import type { ContractTemplateSummary } from '@kit-manager/types';

export const Route = createFileRoute('/_dashboard/templates/')({ component: TemplatesPage });

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function extractVariables(body: string): string[] {
  const matches = body.match(/{{([^}]+)}}/g) ?? [];
  return [...new Set(matches)];
}

function TemplateListItem({
  template,
  active,
  onSelect,
  onDelete,
}: {
  template: ContractTemplateSummary;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={`group flex items-start gap-2 px-4 py-3 transition-colors hover:bg-muted/50 ${active ? 'bg-accent-soft' : ''}`}>
      <button type="button" onClick={onSelect} className="flex-1 min-w-0 text-left">
        <div className="flex items-center gap-2">
          <p className={`text-sm font-medium truncate ${active ? 'text-accent-ink' : 'text-foreground'}`}>
            {template.name}
          </p>
          <Pill tone={template.status === 'published' ? 'ok' : 'warn'}>
            {template.status === 'published' ? 'Publ.' : 'Rasc.'}
          </Pill>
        </div>
        <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{template.code}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          em uso · {template.usageCount} · atualizado {new Date(template.updatedAt).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })}
        </p>
      </button>
      <button
        type="button"
        aria-label="Remover template"
        onClick={onDelete}
        className="mt-0.5 rounded p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive transition-all"
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  );
}

function AddVariableInput({ onAdd }: { onAdd: (name: string) => void }) {
  const [name, setName] = useState('');
  const commit = () => {
    const trimmed = name.trim().replace(/\s+/g, '_');
    if (trimmed) { onAdd(trimmed); setName(''); }
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); commit(); }} className="flex items-center gap-1">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="nova_variavel"
        className="w-28 rounded border border-border bg-background px-2 py-0.5 font-mono text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
      />
      <button type="submit" disabled={!name.trim()} className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40">
        + add
      </button>
    </form>
  );
}

function EditorPanel({ templateId }: { templateId: string }) {
  const qc = useQueryClient();
  const editorRef = useRef<HTMLDivElement>(null);
  const [previewing, setPreviewing] = useState(false);
  const [editorFocused, setEditorFocused] = useState(false);
  const [varValues, setVarValues] = useState<Record<string, string>>({});
  const [body, setBody] = useState('');
  const [varOrder, setVarOrder] = useState<string[]>([]);

  const { data: template, isLoading } = useQuery({
    queryKey: ['contract-template', templateId],
    queryFn: () => fetchContractTemplate(templateId),
  });

  // Sync local state once per template load (not on every refetch)
  useEffect(() => {
    if (!template) return;
    setBody(template.body);
    setVarOrder(extractVariables(template.body));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template?.id]);

  const getEditorHtml = useCallback((rawBody: string) =>
    rawBody
      .split(/(\{\{[^}]+\}\})/g)
      .map((part) => {
        if (part.startsWith('{{') && part.endsWith('}}')) {
          return `<span contenteditable="false" style="background:var(--color-accent-soft);color:var(--color-accent-ink);border-radius:2px;padding:0 2px;font-size:11px;">${escapeHtml(varValues[part] || part)}</span>`;
        }
        return escapeHtml(part).replace(/\n/g, '<br/>');
      })
      .join(''),
  [varValues]);

  useEffect(() => {
    if (!editorFocused && editorRef.current) {
      editorRef.current.innerHTML = getEditorHtml(body);
    }
  }, [body, editorFocused, getEditorHtml]);

  const saveMutation = useMutation({
    mutationFn: () => adminApi.updateContractTemplate(templateId, { body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contract-template', templateId] });
      toast.success('Template salvo');
    },
    onError: () => toast.error('Falha ao salvar template'),
  });

  const publishMutation = useMutation({
    mutationFn: (status: string) => adminApi.updateContractTemplate(templateId, { status }),
    onSuccess: (_, status) => {
      qc.invalidateQueries({ queryKey: ['contract-template', templateId] });
      qc.invalidateQueries({ queryKey: ['contract-templates'] });
      toast.success(status === 'published' ? 'Publicado' : 'Revertido para rascunho');
    },
    onError: () => toast.error('Falha ao atualizar status'),
  });

  const insertVariable = useCallback((variable: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    document.execCommand('insertText', false, variable);
  }, []);

  const handleAddVariable = (name: string) => {
    const tag = `{{${name}}}`;
    if (!varOrder.includes(tag)) setVarOrder((o) => [...o, tag]);
    setBody((b) => b + (b.endsWith('\n') || b === '' ? '' : ' ') + tag);
  };

  const handleCancel = () => {
    if (!template) return;
    setBody(template.body);
    setVarOrder(extractVariables(template.body));
  };

  if (isLoading || !template) {
    return <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">Carregando…</div>;
  }

  return (
    <div className="flex flex-col rounded-[10px] bg-surface-raised p-5" style={{ boxShadow: 'var(--shadow-sm)' }}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-sm font-medium text-foreground truncate">{template.name}</h2>
          <span className="font-mono text-[11px] text-muted-foreground shrink-0">{template.code}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <CustomButton variant="ghost" size="sm" onClick={() => setPreviewing((p) => !p)}>
            {previewing ? 'Editar' : 'Pré-visualizar'}
          </CustomButton>
          <CustomButton
            variant="secondary"
            size="sm"
            onClick={() => publishMutation.mutate(template.status === 'published' ? 'draft' : 'published')}
            disabled={publishMutation.isPending}
          >
            {template.status === 'published' ? 'Rascunho' : 'Publicar'}
          </CustomButton>
        </div>
      </div>

      {!previewing && (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            {varOrder.map((v) => (
              <div key={v} className="flex items-center gap-0.5 rounded bg-accent-soft">
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insertVariable(v)}
                  className="px-1.5 py-0.5 font-mono text-[11px] text-accent-ink hover:opacity-80 transition-opacity"
                  title="Inserir no cursor"
                >
                  {v}
                </button>
                <button
                  type="button"
                  aria-label={`Remover ${v}`}
                  onClick={() => {
                    setBody((b) => b.replaceAll(v, ''));
                    setVarOrder((o) => o.filter((x) => x !== v));
                  }}
                  className="pr-1 text-accent-ink/60 hover:text-destructive transition-colors text-[10px] leading-none"
                >
                  ×
                </button>
              </div>
            ))}
            <AddVariableInput onAdd={handleAddVariable} />
          </div>
          {varOrder.length > 0 && (
            <div className="mb-3 grid gap-2 sm:grid-cols-2">
              {varOrder.map((v) => (
                <div key={v} className="flex items-center gap-1.5">
                  <span className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[11px] text-accent-ink bg-accent-soft w-32 truncate">{v}</span>
                  <input
                    value={varValues[v] ?? ''}
                    onChange={(e) => setVarValues((prev) => ({ ...prev, [v]: e.target.value }))}
                    placeholder={v.replace(/{{|}}/g, '')}
                    className="flex-1 rounded border border-border bg-background px-2 py-0.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                  />
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {previewing ? (
        <div className="flex-1 min-h-[300px] overflow-y-auto rounded-lg border border-border bg-muted/30 p-4 font-mono text-sm leading-relaxed text-foreground whitespace-pre-wrap">
          {body.replace(/{{([^}]+)}}/g, (match, key) => varValues[`{{${key}}}`] || match)
            .split(/({{[^}]+}})/g)
            .map((part, i) =>
              part.startsWith('{{') ? (
                <span key={i} className="rounded px-0.5 text-accent-ink bg-accent-soft">{part}</span>
              ) : (
                <span key={i}>{part}</span>
              ),
            )}
        </div>
      ) : (
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          onFocus={() => setEditorFocused(true)}
          onBlur={(e) => {
            setEditorFocused(false);
            let raw = e.currentTarget.innerText;
            for (const [placeholder, value] of Object.entries(varValues)) {
              if (value) raw = raw.replaceAll(value, placeholder);
            }
            setBody(raw);
          }}
          className="flex-1 min-h-[300px] overflow-y-auto rounded-lg border border-border bg-muted/30 p-4 font-mono text-sm leading-relaxed text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 whitespace-pre-wrap empty:before:content-['Corpo_do_template…'] empty:before:text-muted-foreground"
        />
      )}

      <div className="mt-3 flex justify-end gap-2">
        <CustomButton variant="secondary" size="sm" onClick={handleCancel}>
          Cancelar
        </CustomButton>
        <CustomButton
          variant="primary"
          size="sm"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending || body === template.body}
        >
          Salvar
        </CustomButton>
      </div>
    </div>
  );
}

function TemplatesPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const qc = useQueryClient();

  const { data: templates = [] } = useQuery({
    queryKey: ['contract-templates'],
    queryFn: fetchContractTemplates,
  });

  const activeId = selectedId ?? templates[0]?.id ?? null;

  const createMutation = useMutation({
    mutationFn: () => adminApi.createContractTemplate('Novo template'),
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ['contract-templates'] });
      setSelectedId((res.data as { id: string }).id);
      toast.success('Template criado');
    },
    onError: () => toast.error('Falha ao criar template'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => adminApi.deleteContractTemplate(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contract-templates'] });
      setSelectedId(null);
      toast.success('Template removido');
    },
    onError: () => toast.error('Falha ao remover template'),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Templates"
        subtitle="Contratos e documentos"
        actions={
          <div className="flex gap-2">
            <CustomButton variant="secondary" size="sm" onClick={() => toast.info('Em breve')}>
              <Upload className="size-4" />
              Importar .docx
            </CustomButton>
            <CustomButton
              variant="primary"
              size="sm"
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending}
            >
              <Plus className="size-4" />
              Novo template
            </CustomButton>
          </div>
        }
      />

      <div className="grid h-[calc(100vh-220px)] min-h-[400px] gap-4 lg:grid-cols-[280px_1fr]">
        <div className="overflow-y-auto rounded-[10px] bg-surface-raised divide-y divide-border" style={{ boxShadow: 'var(--shadow-sm)' }}>
          {templates.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">Nenhum template. Crie um para começar.</p>
          ) : (
            templates.map((t) => (
              <TemplateListItem
                key={t.id}
                template={t}
                active={t.id === activeId}
                onSelect={() => setSelectedId(t.id)}
                onDelete={() => deleteMutation.mutate(t.id)}
              />
            ))
          )}
        </div>

        {activeId ? (
          <EditorPanel key={activeId} templateId={activeId} />
        ) : (
          <div className="flex items-center justify-center rounded-[10px] border border-border bg-surface-raised">
            <p className="text-sm text-muted-foreground">Selecione um template para editar.</p>
          </div>
        )}
      </div>
    </div>
  );
}
