import { useRef, useState, useCallback, useEffect } from 'react';
import { ImagePlus, Video, X, GripVertical } from 'lucide-react';

export interface MediaFile {
  id: string;
  file: File;
  preview: string;
  type: 'photo' | 'video';
  label: string;
}

interface MediaUploaderProps {
  onFilesChange?: (files: File[]) => void;
}

export function MediaUploader({ onFilesChange }: MediaUploaderProps) {
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const mounted = useRef(false);
  const onFilesChangeRef = useRef(onFilesChange);
  onFilesChangeRef.current = onFilesChange;

  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    onFilesChangeRef.current?.(files.map((f) => f.file));
  }, [files]);

  function addFiles(raw: FileList | null) {
    if (!raw) return;
    const next: MediaFile[] = Array.from(raw)
      .filter((f) => f.type.startsWith('image/') || f.type.startsWith('video/'))
      .map((f) => ({
        id: crypto.randomUUID(),
        file: f,
        preview: URL.createObjectURL(f),
        type: f.type.startsWith('video/') ? 'video' : 'photo',
        label: '',
      }));
    setFiles((prev) => [...prev, ...next]);
  }

  function remove(id: string) {
    setFiles((prev) => {
      const removed = prev.find((f) => f.id === id);
      if (removed) URL.revokeObjectURL(removed.preview);
      return prev.filter((f) => f.id !== id);
    });
  }

  function updateLabel(id: string, label: string) {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, label } : f)));
  }

  const filesRef = useRef(files);
  filesRef.current = files;
  useEffect(() => {
    return () => { filesRef.current.forEach((f) => URL.revokeObjectURL(f.preview)); };
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  }, []);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  const onDragLeave = useCallback(() => setDragging(false), []);

  return (
    <div className="space-y-3">
      {/* Drop zone */}
      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onClick={() => inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
          dragging
            ? 'border-primary bg-accent-soft'
            : 'border-border bg-muted/20 hover:border-primary/50 hover:bg-muted/40'
        }`}
      >
        <div className="flex gap-2 text-muted-foreground">
          <ImagePlus className="size-5" />
          <Video className="size-5" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">
            Arraste fotos e vídeos ou{' '}
            <span className="text-primary">clique para selecionar</span>
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            JPG, PNG, WebP, MP4, MOV — máx. 50 MB por arquivo
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*,video/*"
          className="hidden"
          onChange={(e) => addFiles(e.target.files)}
        />
      </div>

      {/* Preview grid */}
      {files.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {files.map((f, idx) => (
            <div
              key={f.id}
              className="group relative overflow-hidden rounded-lg border border-border bg-muted"
            >
              {f.type === 'photo' ? (
                <img
                  src={f.preview}
                  alt={f.label || `foto ${idx + 1}`}
                  className="aspect-[4/3] w-full object-cover"
                />
              ) : (
                <div className="flex aspect-[4/3] w-full items-center justify-center bg-muted/80">
                  <Video className="size-8 text-muted-foreground/60" />
                  <span className="ml-1.5 text-xs text-muted-foreground">{f.file.name}</span>
                </div>
              )}

              <div className="absolute inset-0 flex flex-col justify-between bg-gradient-to-t from-black/60 via-transparent to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
                <div className="flex justify-between">
                  <GripVertical className="size-4 cursor-grab text-white/80" />
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); remove(f.id); }}
                    className="flex size-5 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/80"
                    aria-label="Remover"
                  >
                    <X className="size-3" />
                  </button>
                </div>
                <input
                  type="text"
                  value={f.label}
                  onChange={(e) => updateLabel(f.id, e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  placeholder="Legenda..."
                  className="w-full rounded bg-black/50 px-1.5 py-0.5 text-xs text-white placeholder:text-white/50 focus:outline-none"
                />
              </div>

              <span className="absolute left-1.5 top-1.5 rounded bg-black/50 px-1.5 py-0.5 text-[10px] font-medium uppercase text-white">
                {f.type === 'video' ? 'Vídeo' : `Foto ${idx + 1}`}
              </span>
            </div>
          ))}
        </div>
      )}

      {files.length > 0 && (
        <p className="text-right text-xs text-muted-foreground">
          {files.filter((f) => f.type === 'photo').length} foto(s) ·{' '}
          {files.filter((f) => f.type === 'video').length} vídeo(s)
        </p>
      )}
    </div>
  );
}
