import { useEffect, useId, useRef, useState } from 'react';
import {
  WAN_DEFAULT_DURATION,
  WAN_DEFAULT_FLOW_SHIFT,
  WAN_DEFAULT_FPS,
  WAN_DEFAULT_GUIDANCE,
  WAN_DEFAULT_GUIDANCE_2,
  WAN_DEFAULT_NEGATIVE,
  WAN_DEFAULT_PROMPT,
  WAN_DEFAULT_QUALITY,
  WAN_DEFAULT_RANDOMIZE,
  WAN_DEFAULT_SAFE_MODE,
  WAN_DEFAULT_SCHEDULER,
  WAN_DEFAULT_SEED,
  WAN_DEFAULT_STEPS,
  WAN_DEFAULT_VIDEO_COMPONENT,
  WAN_EMBED_URL,
  WAN_FPS_CHOICES,
  WAN_SCHEDULERS,
  WAN_SPACE_PAGE,
  probeWanCors,
  type GeneratedVideo,
  type WanFps,
  type WanScheduler,
} from '@/adapters/wan';
import { useImageStore } from '@/store/imageStore';

export function Wan22Panel() {
  const videos = useImageStore((s) => s.videos);
  const wanBusy = useImageStore((s) => s.wanBusy);
  const wanProgress = useImageStore((s) => s.wanProgress);
  const wanError = useImageStore((s) => s.wanError);
  const corsBlocked = useImageStore((s) => s.corsBlocked);
  const generateVideo = useImageStore((s) => s.generateVideo);
  const clearWanError = useImageStore((s) => s.clearWanError);
  const setCorsBlocked = useImageStore((s) => s.setCorsBlocked);

  const inputId = useId();
  const lastId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const lastRef = useRef<HTMLInputElement>(null);

  const [inputFile, setInputFile] = useState<File | null>(null);
  const [inputPreview, setInputPreview] = useState<string | null>(null);
  const [lastFile, setLastFile] = useState<File | null>(null);
  const [prompt, setPrompt] = useState(WAN_DEFAULT_PROMPT);
  const [duration, setDuration] = useState(WAN_DEFAULT_DURATION);
  const [fps, setFps] = useState<WanFps>(WAN_DEFAULT_FPS);
  const [safeMode, setSafeMode] = useState(WAN_DEFAULT_SAFE_MODE);
  const [negative, setNegative] = useState(WAN_DEFAULT_NEGATIVE);
  const [quality, setQuality] = useState(WAN_DEFAULT_QUALITY);
  const [seed, setSeed] = useState(WAN_DEFAULT_SEED);
  const [randomize, setRandomize] = useState(WAN_DEFAULT_RANDOMIZE);
  const [steps, setSteps] = useState(WAN_DEFAULT_STEPS);
  const [guidance, setGuidance] = useState(WAN_DEFAULT_GUIDANCE);
  const [guidance2, setGuidance2] = useState(WAN_DEFAULT_GUIDANCE_2);
  const [scheduler, setScheduler] = useState<WanScheduler>(WAN_DEFAULT_SCHEDULER);
  const [flowShift, setFlowShift] = useState(WAN_DEFAULT_FLOW_SHIFT);
  const [showEmbed, setShowEmbed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void probeWanCors().then((ok) => {
      if (!cancelled) setCorsBlocked(!ok);
    });
    return () => {
      cancelled = true;
    };
  }, [setCorsBlocked]);

  useEffect(() => {
    return () => {
      if (inputPreview) URL.revokeObjectURL(inputPreview);
    };
  }, [inputPreview]);

  function onPickInput(file: File | undefined) {
    if (inputPreview) URL.revokeObjectURL(inputPreview);
    if (!file) {
      setInputFile(null);
      setInputPreview(null);
      return;
    }
    setInputFile(file);
    setInputPreview(URL.createObjectURL(file));
    if (wanError) clearWanError();
  }

  const canGenerate = Boolean(inputFile) && !wanBusy;

  return (
    <div className="space-y-3">
      <p className="text-[11px] uppercase tracking-wider text-fuchsia-200/70">
        Wan 2.2 I2V 14B · kulkas2pintu/wan222
      </p>

      <label htmlFor={inputId} className="block">
        <span className="mb-1 block text-[11px] uppercase tracking-wider text-white/50">Input image (required)</span>
        <button
          type="button"
          className="hud-btn-ghost w-full"
          onClick={() => inputRef.current?.click()}
        >
          {inputFile ? inputFile.name : 'Upload image'}
        </button>
        <input
          id={inputId}
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => onPickInput(e.target.files?.[0])}
        />
      </label>
      {inputPreview ? (
        <img src={inputPreview} alt="Input" className="max-h-40 w-full rounded-2xl border border-white/10 object-contain bg-black/40" />
      ) : (
        <p className="rounded-2xl border border-dashed border-white/15 px-3 py-6 text-center text-sm text-white/45">
          Pick a still. Wan 2.2 turns it into video — it is not a stills model.
        </p>
      )}

      <label className="block">
        <span className="mb-1 block text-[11px] uppercase tracking-wider text-white/50">Prompt</span>
        <textarea
          value={prompt}
          onChange={(e) => {
            setPrompt(e.target.value);
            if (wanError) clearWanError();
          }}
          rows={3}
          className="hud-input min-h-[4.5rem] w-full resize-y"
        />
      </label>

      <label className="block">
        <span className="mb-1 flex justify-between text-[11px] uppercase tracking-wider text-white/50">
          <span>Duration</span>
          <span className="text-cyan-100/80">{duration.toFixed(1)}s</span>
        </span>
        <input
          type="range"
          min={0.5}
          max={10}
          step={0.5}
          value={duration}
          onChange={(e) => setDuration(Number(e.target.value))}
          className="w-full accent-cyan-300"
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-[11px] uppercase tracking-wider text-white/50">FPS</span>
        <select
          value={fps}
          onChange={(e) => setFps(Number(e.target.value) as WanFps)}
          className="hud-input w-full"
        >
          {WAN_FPS_CHOICES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>

      <label className="flex min-h-[44px] items-center gap-2 text-sm">
        <input type="checkbox" checked={safeMode} onChange={(e) => setSafeMode(e.target.checked)} />
        Safe Mode
      </label>

      <button
        type="button"
        disabled={!canGenerate}
        className="hud-btn-primary w-full disabled:opacity-50"
        onClick={() => {
          if (!inputFile) return;
          void generateVideo({
            inputImage: inputFile,
            lastImage: lastFile,
            prompt: prompt.trim() || WAN_DEFAULT_PROMPT,
            steps,
            negativePrompt: negative,
            durationSeconds: duration,
            guidanceScale: guidance,
            guidanceScale2: guidance2,
            seed,
            randomizeSeed: randomize,
            quality,
            scheduler,
            flowShift,
            frameMultiplier: fps,
            videoComponent: WAN_DEFAULT_VIDEO_COMPONENT,
            safeMode,
          });
        }}
      >
        {wanBusy ? 'Generating…' : 'Generate Video'}
      </button>

      {wanBusy || wanProgress ? (
        <p className="rounded-xl border border-cyan-400/30 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-50">
          {wanProgress ?? 'Working…'}
        </p>
      ) : null}

      {wanError ? (
        <p className="rounded-xl border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">{wanError}</p>
      ) : null}

      <details className="rounded-2xl border border-white/10 bg-black/20 px-3 py-1">
        <summary className="min-h-[44px] cursor-pointer list-none py-2 text-[11px] uppercase tracking-wider text-white/70">
          Advanced
        </summary>
        <div className="space-y-3 pb-3">
          <label className="block">
            <span className="mb-1 block text-[11px] uppercase tracking-wider text-white/50">Last image (optional)</span>
            <button type="button" className="hud-btn-ghost w-full" onClick={() => lastRef.current?.click()}>
              {lastFile ? lastFile.name : 'None'}
            </button>
            <input
              id={lastId}
              ref={lastRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => setLastFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] uppercase tracking-wider text-white/50">Negative prompt</span>
            <textarea value={negative} onChange={(e) => setNegative(e.target.value)} rows={4} className="hud-input min-h-[5rem] w-full resize-y text-xs" />
          </label>
          <NumField label={`Quality ${quality}`} min={1} max={10} step={1} value={quality} onChange={setQuality} />
          <label className="block">
            <span className="mb-1 block text-[11px] uppercase tracking-wider text-white/50">Seed</span>
            <input
              type="number"
              min={0}
              max={2147483647}
              value={seed}
              onChange={(e) => setSeed(Number(e.target.value) || 0)}
              className="hud-input w-full"
            />
          </label>
          <label className="flex min-h-[44px] items-center gap-2 text-sm">
            <input type="checkbox" checked={randomize} onChange={(e) => setRandomize(e.target.checked)} />
            Randomize seed
          </label>
          <NumField label={`Steps ${steps}`} min={1} max={30} step={1} value={steps} onChange={setSteps} />
          <NumField
            label={`Guidance ${guidance}`}
            min={0}
            max={10}
            step={0.1}
            value={guidance}
            onChange={setGuidance}
          />
          <NumField
            label={`Guidance 2 ${guidance2}`}
            min={0}
            max={10}
            step={0.1}
            value={guidance2}
            onChange={setGuidance2}
          />
          <label className="block">
            <span className="mb-1 block text-[11px] uppercase tracking-wider text-white/50">Scheduler</span>
            <select
              value={scheduler}
              onChange={(e) => setScheduler(e.target.value as WanScheduler)}
              className="hud-input w-full"
            >
              {WAN_SCHEDULERS.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <NumField
            label={`Flow shift ${flowShift}`}
            min={0.5}
            max={15}
            step={0.1}
            value={flowShift}
            onChange={setFlowShift}
          />
        </div>
      </details>

      {videos[0] ? <VideoCard video={videos[0]} featured /> : null}
      {videos.slice(1).map((video) => (
        <VideoCard key={video.id} video={video} />
      ))}

      {corsBlocked || showEmbed ? (
        <div className="space-y-2">
          <p className="text-xs leading-relaxed text-white/55">
            {corsBlocked
              ? 'Native API is blocked from this origin. The embed is the same Space UI. You can also open it in a new tab.'
              : 'Same Space, embedded. Native Generate Video is preferred when CORS allows it.'}
          </p>
          <iframe
            title="Wan 2.2 Space"
            src={WAN_EMBED_URL}
            className="h-[28rem] w-full rounded-2xl border border-white/10 bg-black"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          />
        </div>
      ) : (
        <button type="button" className="hud-btn-ghost w-full text-[11px]" onClick={() => setShowEmbed(true)}>
          Show Space embed
        </button>
      )}

      <a
        href={WAN_SPACE_PAGE}
        target="_blank"
        rel="noreferrer"
        className="block text-center text-[11px] uppercase tracking-wider text-cyan-200/80 underline decoration-cyan-400/40"
      >
        Open in Space
      </a>
    </div>
  );
}

function NumField({
  label,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] uppercase tracking-wider text-white/50">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-cyan-300"
      />
    </label>
  );
}

function VideoCard({ video, featured = false }: { video: GeneratedVideo; featured?: boolean }) {
  return (
    <figure className="overflow-hidden rounded-2xl border border-white/10 bg-black/40">
      <video
        src={video.url}
        controls
        playsInline
        preload={featured ? 'metadata' : 'none'}
        className={featured ? 'max-h-64 w-full bg-black' : 'max-h-40 w-full bg-black'}
      />
      <figcaption className="flex items-center justify-between gap-2 px-2 py-1">
        <span className="truncate text-[10px] text-white/50">{video.prompt}</span>
        <a href={video.url} target="_blank" rel="noreferrer" download className="shrink-0 text-[11px] text-cyan-200/80">
          Download
        </a>
      </figcaption>
    </figure>
  );
}
