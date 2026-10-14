import { useState } from 'react';
import { ExternalLink, Plus } from 'lucide-react';
import { WidgetFrame } from '@/components/shell/WidgetFrame';
import { useLinksStore } from '@/store/linksStore';
import type { WidgetRenderProps } from '@/registry/types';

function normalizeUrl(raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  if (/^https?:\/\//i.test(t)) return t;
  return `https://${t}`;
}

export function LinksWidget({ widget }: WidgetRenderProps) {
  const tiles = useLinksStore((s) => s.tiles);
  const add = useLinksStore((s) => s.add);
  const remove = useLinksStore((s) => s.remove);
  const saveNotice = useLinksStore((s) => s.saveNotice);
  const saveError = useLinksStore((s) => s.saveError);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');

  return (
    <WidgetFrame
      widget={widget}
      title="Links"
      footer={
        <div>
          {saveError ? (
            <p className="mb-1 text-xs text-rose-300" role="alert">
              {saveError}
            </p>
          ) : saveNotice === 'saved' ? (
            <p className="mb-1 text-xs text-cyan-200" role="status">
              Saved
            </p>
          ) : null}
          <p className="text-[11px] leading-snug text-white/45">
            Saved on this device and browser. They don&apos;t sync between github.io and the Vercel site.
          </p>
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-2">
        {tiles.map((tile) => (
          <a
            key={tile.id}
            href={tile.url}
            target="_blank"
            rel="noreferrer"
            className="link-tile group relative"
            style={{ borderColor: tile.color }}
          >
            <span className="font-display text-xs uppercase tracking-widest">{tile.title}</span>
            <ExternalLink className="h-3 w-3 opacity-50" />
            <button
              type="button"
              className="absolute right-1 top-1 hidden rounded bg-black/50 px-1 text-[10px] group-hover:block"
              onClick={(e) => {
                e.preventDefault();
                remove(tile.id);
              }}
            >
              ×
            </button>
          </a>
        ))}
        <form
          className="link-tile flex-col items-stretch justify-center gap-1 border-dashed"
          onSubmit={(e) => {
            e.preventDefault();
            const href = normalizeUrl(url);
            if (!title.trim() || !href) return;
            add(title.trim(), href);
            setTitle('');
            setUrl('');
          }}
        >
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Label"
            className="hud-input w-full text-xs"
          />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://"
            className="hud-input w-full text-xs"
          />
          <button type="submit" className="hud-btn-ghost mt-1 w-full">
            <Plus className="h-4 w-4" /> Add
          </button>
        </form>
      </div>
    </WidgetFrame>
  );
}
