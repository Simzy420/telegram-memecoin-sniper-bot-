import { useState } from 'react';
import { WAN_EXTEND_EMBED_URL, WAN_EXTEND_SPACE_URL } from '@/adapters/wan/extend';
import { embedFrameAccepted } from '@/lib/embedFrame';

export function WanExtendPanel() {
  const [embedBlocked, setEmbedBlocked] = useState(false);

  return (
    <div className="space-y-3">
      <p className="text-[11px] uppercase tracking-wider text-fuchsia-200/70">Wan 2.2 Extend · Runpod</p>
      <p className="text-sm leading-relaxed text-white/70">
        Extend a clip on the hosted Space. The first run can take a few minutes while the Runpod worker starts.
      </p>
      <a href={WAN_EXTEND_SPACE_URL} target="_blank" rel="noreferrer" className="hud-btn-primary min-h-[48px] w-full">
        Open Wan Extend
      </a>
      {embedBlocked ? (
        <p className="text-xs leading-relaxed text-white/55">
          This page can&apos;t embed the Space. Open Wan Extend still opens it in a new tab.
        </p>
      ) : (
        <>
          <p className="text-xs leading-relaxed text-white/55">
            Same Space, embedded. If the frame stays blank, use Open Wan Extend.
          </p>
          <iframe
            title="Wan 2.2 Extend"
            src={WAN_EXTEND_EMBED_URL}
            className="h-[28rem] w-full rounded-2xl border border-white/10 bg-black"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            onLoad={(event) => {
              if (!embedFrameAccepted(event.currentTarget)) setEmbedBlocked(true);
            }}
          />
        </>
      )}
    </div>
  );
}
