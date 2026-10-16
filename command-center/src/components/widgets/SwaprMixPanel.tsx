import { useState } from 'react';
import { SWAPR_MIX_APP_URL } from '@/adapters/swaprMix';
import { embedFrameAccepted } from '@/lib/embedFrame';

export function SwaprMixPanel() {
  const [embedBlocked, setEmbedBlocked] = useState(false);

  return (
    <div className="space-y-3">
      <p className="text-[11px] uppercase tracking-wider text-fuchsia-200/70">
        Swapr Mix · keep the props · Runpod
      </p>
      <p className="text-sm leading-relaxed text-white/70">
        Same motions as Swapr, but mark the person (green) and props to keep (red) before Generate so
        handheld objects stay. Prefer <span className="text-white/90">Open Swapr Mix</span> on phone —
        file pickers often fail inside the embedded frame.
      </p>
      <a href={SWAPR_MIX_APP_URL} target="_blank" rel="noreferrer" className="hud-btn-primary min-h-[48px] w-full">
        Open Swapr Mix
      </a>
      <p className="text-xs leading-relaxed text-white/55">
        In Mix: Motions → mark person + mark keep on props → upload your still → Generate Mix.
      </p>
      {embedBlocked ? (
        <p className="text-xs leading-relaxed text-white/55">
          This page can&apos;t embed the app. Open Swapr Mix still opens it in a new tab.
        </p>
      ) : (
        <>
          <p className="text-xs leading-relaxed text-white/55">
            Preview embed only. Prefer Open Swapr Mix to mark props or upload photos.
          </p>
          <iframe
            title="Swapr Mix"
            src={SWAPR_MIX_APP_URL}
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
