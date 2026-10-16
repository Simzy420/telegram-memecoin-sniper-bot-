import { useEffect, useId, useRef, useState } from 'react';
import { ImagePlus, Trash2, X } from 'lucide-react';
import { WidgetFrame } from '@/components/shell/WidgetFrame';
import { cn } from '@/lib/cn';
import { useGalleryStore, type GalleryItem } from '@/store/galleryStore';
import type { WidgetRenderProps } from '@/registry/types';

export function GalleryWidget({ widget }: WidgetRenderProps) {
  const items = useGalleryStore((s) => s.items);
  const busy = useGalleryStore((s) => s.busy);
  const hydrated = useGalleryStore((s) => s.hydrated);
  const saveNotice = useGalleryStore((s) => s.saveNotice);
  const saveError = useGalleryStore((s) => s.saveError);
  const addFiles = useGalleryStore((s) => s.addFiles);
  const addUrl = useGalleryStore((s) => s.addUrl);
  const remove = useGalleryStore((s) => s.remove);
  const clearError = useGalleryStore((s) => s.clearError);
  const rehydrate = useGalleryStore((s) => s.rehydrate);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pickNotice, setPickNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!hydrated) void rehydrate();
  }, [hydrated, rehydrate]);

  const active = items.find((item) => item.id === activeId) ?? null;

  async function onPick(files: FileList | null) {
    if (!files?.length) return;
    clearError();
    setPickNotice(null);
    const result = await addFiles(files);
    if (result.added > 0) {
      setPickNotice(
        result.skipped
          ? `Added ${result.added}. Skipped ${result.skipped} unsupported or oversized file${result.skipped === 1 ? '' : 's'}.`
          : `Added ${result.added} item${result.added === 1 ? '' : 's'}.`,
      );
    } else if (result.skipped) {
      setPickNotice('No files added. Use images or videos under 12 MB each.');
    }
    if (inputRef.current) inputRef.current.value = '';
  }

  return (
    <WidgetFrame
      widget={widget}
      title="Photo gallery"
      badge={items.length ? `${items.length}` : 'LIVE'}
      footer={
        <div>
          {saveError ? (
            <p className="mb-1 text-xs text-rose-300" role="alert">
              {saveError}
            </p>
          ) : saveNotice === 'saved' ? (
            <p className="mb-1 text-xs text-cyan-200" role="status">
              Saved on this device
            </p>
          ) : pickNotice ? (
            <p className="mb-1 text-xs text-cyan-200" role="status">
              {pickNotice}
            </p>
          ) : null}
          <p className="text-[11px] leading-snug text-white/45">
            Add as many photos and videos as you want. They stay on this device — nothing is uploaded.
          </p>
        </div>
      }
    >
      <div className="mb-3 flex flex-col gap-2">
        <button
          type="button"
          className="hud-btn-primary widget-no-drag min-h-[48px] w-full"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          <ImagePlus className="h-4 w-4" />
          {busy ? 'Adding…' : 'Choose photos & videos'}
        </button>
        <input
          id={inputId}
          ref={inputRef}
          type="file"
          accept="image/*,video/*"
          multiple
          className="hidden"
          onChange={(e) => void onPick(e.target.files)}
        />
        <form
          className="flex flex-col gap-2 rounded-2xl border border-dashed border-white/15 p-2"
          onSubmit={(e) => {
            e.preventDefault();
            void (async () => {
              clearError();
              setPickNotice(null);
              const ok = await addUrl(url, label);
              if (!ok) return;
              setUrl('');
              setLabel('');
              setPickNotice('Added from URL.');
            })();
          }}
        >
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (optional)"
            className="hud-input w-full text-xs"
          />
          <div className="flex gap-2">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https:// image or video URL"
              className="hud-input flex-1 text-xs"
            />
            <button type="submit" disabled={!url.trim() || busy} className="hud-btn-ghost px-3 disabled:opacity-50">
              Add
            </button>
          </div>
        </form>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {items.map((item) => (
          <GalleryTile
            key={item.id}
            item={item}
            onOpen={() => setActiveId(item.id)}
            onRemove={() => void remove(item.id)}
          />
        ))}
        {items.length === 0 && hydrated ? (
          <p className="col-span-full rounded-2xl border border-dashed border-white/15 px-3 py-8 text-center text-sm text-white/45">
            Empty gallery. Tap Choose photos &amp; videos to pick as many as you want, or paste a URL.
          </p>
        ) : null}
        {!hydrated ? (
          <p className="col-span-full px-3 py-6 text-center text-sm text-white/40">Loading gallery…</p>
        ) : null}
      </div>

      {active ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-3"
          role="dialog"
          aria-modal="true"
          aria-label={active.name}
          onClick={() => setActiveId(null)}
        >
          <button
            type="button"
            className="absolute right-3 top-3 rounded-lg bg-black/50 p-2 text-white"
            aria-label="Close"
            onClick={() => setActiveId(null)}
          >
            <X className="h-5 w-5" />
          </button>
          <div className="max-h-[90vh] w-full max-w-3xl" onClick={(e) => e.stopPropagation()}>
            {active.kind === 'video' ? (
              <video src={active.src} controls playsInline className="max-h-[80vh] w-full rounded-2xl bg-black" />
            ) : (
              <img
                src={active.src}
                alt={active.name}
                className="max-h-[80vh] w-full rounded-2xl object-contain"
                referrerPolicy="no-referrer"
              />
            )}
            <p className="mt-2 truncate text-center text-sm text-white/70">{active.name}</p>
          </div>
        </div>
      ) : null}
    </WidgetFrame>
  );
}

function GalleryTile({
  item,
  onOpen,
  onRemove,
}: {
  item: GalleryItem;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const [failed, setFailed] = useState(false);

  return (
    <figure className="group relative overflow-hidden rounded-2xl border border-white/10 bg-black/30">
      <button type="button" className="block w-full text-left" onClick={onOpen}>
        {failed ? (
          <div className="flex aspect-square items-center justify-center px-2 text-center text-[11px] text-rose-200/80">
            Couldn&apos;t load
          </div>
        ) : item.kind === 'video' ? (
          <video
            src={item.src}
            muted
            playsInline
            preload="metadata"
            className="aspect-square w-full object-cover"
            onError={() => setFailed(true)}
          />
        ) : (
          <img
            src={item.src}
            alt={item.name}
            referrerPolicy="no-referrer"
            className="aspect-square w-full object-cover"
            onError={() => setFailed(true)}
          />
        )}
      </button>
      <figcaption className="flex items-center gap-1 truncate px-2 py-1 text-[10px] text-white/55">
        <span className={cn('truncate', item.kind === 'video' && 'text-fuchsia-200/80')}>
          {item.kind === 'video' ? 'Video · ' : ''}
          {item.name}
        </span>
      </figcaption>
      <button
        type="button"
        className="absolute right-1 top-1 rounded bg-black/55 p-1 text-white/70 opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
        aria-label={`Remove ${item.name}`}
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </figure>
  );
}
