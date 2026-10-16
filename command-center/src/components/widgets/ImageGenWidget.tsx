import { useState } from 'react';
import { WidgetFrame } from '@/components/shell/WidgetFrame';
import { OpenAiKeyFields } from '@/components/image/OpenAiKeyFields';
import { StillProviderSwitch } from '@/components/image/StillProviderSwitch';
import type { GeneratedImage } from '@/adapters/imagegen';
import { shouldUseImageProxy } from '@/adapters/imagegen';
import { PERCHANCE_PHOTO_URL } from '@/adapters/perchance';
import { Wan22Panel } from '@/components/widgets/Wan22Panel';
import { SwaprPanel } from '@/components/widgets/SwaprPanel';
import { SwaprMixPanel } from '@/components/widgets/SwaprMixPanel';
import { WanExtendPanel } from '@/components/widgets/WanExtendPanel';
import { cn } from '@/lib/cn';
import { useImageStore, type ImageGenModel } from '@/store/imageStore';
import { useVaultStore } from '@/store/vaultStore';
import type { WidgetRenderProps } from '@/registry/types';

export function ImageGenWidget({ widget }: WidgetRenderProps) {
  const model = useImageStore((s) => s.model);
  const setModel = useImageStore((s) => s.setModel);

  return (
    <WidgetFrame widget={widget} title="Image gen">
      <div className="mb-3 grid grid-cols-2 gap-2" role="group" aria-label="Image model">
        <button
          type="button"
          aria-pressed={model === 'stills'}
          className={cn(
            'hud-btn-ghost min-h-[48px] whitespace-normal px-1 text-center text-[11px] leading-tight',
            model === 'stills' && 'hud-btn-primary',
          )}
          onClick={() => setModel('stills')}
        >
          Stills
        </button>
        <button
          type="button"
          aria-pressed={model === 'wan22'}
          className={cn(
            'hud-btn-ghost min-h-[48px] whitespace-normal px-1 text-center text-[11px] leading-tight',
            model === 'wan22' && 'hud-btn-primary',
          )}
          onClick={() => setModel('wan22')}
        >
          Wan 2.2
        </button>
        <button
          type="button"
          aria-pressed={model === 'wanExtend'}
          className={cn(
            'hud-btn-ghost min-h-[48px] whitespace-normal px-1 text-center text-[11px] leading-tight',
            model === 'wanExtend' && 'hud-btn-primary',
          )}
          onClick={() => setModel('wanExtend')}
        >
          Wan Extend
        </button>
        <div className="col-span-2 grid grid-cols-2 gap-2">
          <button
            type="button"
            aria-pressed={model === 'swapr'}
            className={cn(
              'hud-btn-ghost min-h-[48px] whitespace-normal px-1 text-center text-[11px] leading-tight',
              model === 'swapr' && 'hud-btn-primary',
            )}
            onClick={() => setModel('swapr')}
          >
            Swapr
          </button>
          <button
            type="button"
            aria-pressed={model === 'swaprMix'}
            className={cn(
              'hud-btn-ghost min-h-[48px] whitespace-normal px-1 text-center text-[11px] leading-tight',
              model === 'swaprMix' && 'hud-btn-primary',
            )}
            onClick={() => setModel('swaprMix')}
          >
            Swapr Mix
          </button>
        </div>
      </div>
      <a
        href={PERCHANCE_PHOTO_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="hud-btn-ghost widget-no-drag mb-3 min-h-[48px] w-full normal-case tracking-normal"
      >
        Perchance (free)
      </a>
      <ModelPanel model={model} />
    </WidgetFrame>
  );
}

function ModelPanel({ model }: { model: ImageGenModel }) {
  if (model === 'wan22') return <Wan22Panel />;
  if (model === 'wanExtend') return <WanExtendPanel />;
  if (model === 'swapr') return <SwaprPanel />;
  if (model === 'swaprMix') return <SwaprMixPanel />;
  return <StillsPanel />;
}

function StillsPanel() {
  const images = useImageStore((s) => s.images);
  const busy = useImageStore((s) => s.busy);
  const error = useImageStore((s) => s.error);
  const generate = useImageStore((s) => s.generate);
  const clearError = useImageStore((s) => s.clearError);
  const stillProvider = useImageStore((s) => s.stillProvider);
  const hasKey = useVaultStore((s) => s.hasKey);
  const [prompt, setPrompt] = useState('');
  const proxy = shouldUseImageProxy();
  const emptyCopy =
    stillProvider === 'openai'
      ? proxy
        ? 'Type a prompt and tap Gen. Pictures come from OpenAI on this host.'
        : hasKey
          ? 'Type a prompt and tap Gen. Pictures come from OpenAI.'
          : 'Paste an OpenAI key above, or switch to Pollinations (free).'
      : 'Type a prompt and tap Gen. Pictures load from Pollinations — no API key.';

  return (
    <>
      <StillProviderSwitch className="sticky top-0 z-10 -mx-3 mb-3 bg-[#0c1430] px-3 py-2" />
      {stillProvider === 'openai' ? (
        <OpenAiKeyFields />
      ) : (
        <p className="mb-2 text-[11px] uppercase tracking-wider text-fuchsia-200/70">Free · no API key</p>
      )}
      <form
        className="mb-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void generate(prompt, 4);
        }}
      >
        <input
          value={prompt}
          onChange={(e) => {
            setPrompt(e.target.value);
            if (error) clearError();
          }}
          placeholder="Prompt"
          className="hud-input flex-1"
        />
        <button type="submit" disabled={busy || !prompt.trim()} className="hud-btn-primary px-3 disabled:opacity-50">
          {busy ? '…' : 'Gen'}
        </button>
      </form>
      {error ? (
        <p className="mb-3 rounded-xl border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">{error}</p>
      ) : null}
      {busy ? <p className="mb-2 text-xs text-white/50">Generating — first frames can take a few seconds.</p> : null}
      <div className="grid grid-cols-2 gap-2">
        {images.map((img) => (
          <ImageTile key={img.id} img={img} />
        ))}
        {images.length === 0 && !busy ? (
          <p className="col-span-2 rounded-2xl border border-dashed border-white/15 px-3 py-8 text-center text-sm text-white/45">
            {emptyCopy}
          </p>
        ) : null}
      </div>
    </>
  );
}

function ImageTile({ img }: { img: GeneratedImage }) {
  const [failed, setFailed] = useState(false);

  return (
    <figure className="overflow-hidden rounded-2xl border border-white/10">
      {img.preview.kind === 'url' ? (
        failed ? (
          <div className="flex aspect-square items-center justify-center bg-black/40 px-2 text-center text-[11px] text-rose-200/80">
            Couldn&apos;t load this frame
          </div>
        ) : (
          <img
            src={img.preview.url}
            alt={img.prompt}
            referrerPolicy="no-referrer"
            className="aspect-square w-full bg-black/30 object-cover"
            onError={() => setFailed(true)}
          />
        )
      ) : (
        <div
          className="aspect-square"
          style={{
            background: `linear-gradient(145deg, ${img.preview.colors[0]}, ${img.preview.colors[1]} 55%, ${img.preview.colors[2]})`,
          }}
        />
      )}
      <figcaption className="truncate px-2 py-1 text-[10px] text-white/50">{img.prompt}</figcaption>
    </figure>
  );
}
