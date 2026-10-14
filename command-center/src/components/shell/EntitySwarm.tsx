import { useEffect, useMemo, useRef, useState } from 'react';
import { BOT_ROSTER } from '@/bots/roster';
import { BotAvatar } from '@/components/avatars/BotAvatar';
import {
  BOT_ORBITS,
  REFERENCE_BOX,
  STILL_TIME,
  botOrbit,
  projectBody,
} from '@/components/shell/solarSystemModel';
import { SolarSystemScene } from '@/components/shell/solarSystemScene';
import { cn } from '@/lib/cn';
import { useSessionStore } from '@/store/sessionStore';

const PREFERRED: Record<string, string[]> = {
  scout: ['files', 'gmail'],
  sniper: ['watchlist', 'trading', 'robinhood'],
  pulse: ['chat'],
  ledger: ['robinhood', 'files', 'todo'],
  shield: ['todo', 'watchlist'],
  liquid98: ['imagegen', 'gallery'],
  chief: ['chat', 'links'],
};

const SHORT_LABEL: Record<string, string> = {
  scout: 'Scout',
  sniper: 'Sniper',
  pulse: 'Pulse',
  ledger: 'Ledger',
  shield: 'Shield',
  liquid98: 'Liquid',
  chief: 'Chief',
};

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setReduced(media.matches);
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);
  return reduced;
}

export function EntitySwarm() {
  const reduced = usePrefersReducedMotion();
  const observeOnly = useSessionStore((s) => s.observeOnly);
  const anchors = useSessionStore((s) => s.anchors);
  const activeWidgetId = useSessionStore((s) => s.activeWidgetId);
  const setActiveWidget = useSessionStore((s) => s.setActiveWidget);
  const activeBotId = useSessionStore((s) => s.activeBotId);
  const setActiveBot = useSessionStore((s) => s.setActiveBot);
  const layerRef = useRef<HTMLDivElement>(null);
  const botsRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tiltRef = useRef({ x: 0, y: 0 });
  const observeRef = useRef(observeOnly);
  const anchorCountRef = useRef(anchors.length);
  observeRef.current = observeOnly;
  anchorCountRef.current = anchors.length;

  const initial = useMemo(() => {
    const placed = new Map<string, { x: number; y: number }>();
    for (const orbit of BOT_ORBITS) {
      const point = projectBody(orbit, STILL_TIME, REFERENCE_BOX.width, REFERENCE_BOX.height, 0);
      placed.set(orbit.id, point);
    }
    return placed;
  }, []);

  useEffect(() => {
    if (!observeOnly || anchors.length === 0) return;
    const id = window.setInterval(() => {
      const idx = Math.max(0, anchors.findIndex((a) => a.id === activeWidgetId));
      const next = anchors[(idx + 1) % anchors.length];
      if (next) setActiveWidget(next.id);
    }, 5200);
    return () => window.clearInterval(id);
  }, [observeOnly, anchors, activeWidgetId, setActiveWidget]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const layer = layerRef.current;
    const botsEl = botsRef.current;
    if (!canvas || !layer || !botsEl) return;

    const scene = new SolarSystemScene(canvas);
    const nodes = [...botsEl.querySelectorAll<HTMLElement>('[data-bot]')];
    let raf = 0;
    let visible = true;
    let boxW = layer.clientWidth;
    let boxH = layer.clientHeight;

    const placeOnOrbits = (time: number, tilt: number) => {
      if (boxW < 2 || boxH < 2) return;
      for (const el of nodes) {
        const spec = botOrbit(el.dataset.bot ?? '');
        if (!spec) continue;
        const point = projectBody(spec, time, boxW, boxH, tilt);
        const near = (point.depth + 1) / 2;
        el.style.left = `${point.x}%`;
        el.style.top = `${point.y}%`;
        el.style.zIndex = String(10 + Math.round(near * 20));
        el.style.opacity = reduced ? '1' : (0.8 + near * 0.2).toFixed(3);
        el.style.transform = `translate(-50%, -50%) scale(${(0.9 + near * 0.18).toFixed(3)})`;
      }
    };

    const draw = (time: number) => {
      const tiltX = reduced ? 0 : tiltRef.current.x;
      const tiltY = reduced ? 0 : tiltRef.current.y;
      scene.render(time, tiltX, tiltY, reduced);
      if (!observeRef.current || anchorCountRef.current === 0) placeOnOrbits(time, tiltY);
    };

    const tick = (now: number) => {
      raf = 0;
      if (!visible || document.hidden) return;
      draw(now / 1000);
      raf = requestAnimationFrame(tick);
    };

    const start = () => {
      if (raf || reduced) return;
      raf = requestAnimationFrame(tick);
    };

    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };

    const resizeObserver = new ResizeObserver(() => {
      boxW = layer.clientWidth;
      boxH = layer.clientHeight;
      scene.resize();
      draw(reduced ? STILL_TIME : performance.now() / 1000);
    });
    resizeObserver.observe(layer);

    const observer = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      if (visible && !reduced && !document.hidden) start();
      else stop();
    });
    observer.observe(layer);

    const onVisibility = () => {
      if (document.hidden || !visible) stop();
      else if (!reduced) start();
    };
    document.addEventListener('visibilitychange', onVisibility);

    scene.resize();
    draw(reduced ? STILL_TIME : performance.now() / 1000);
    if (!reduced) start();

    return () => {
      stop();
      resizeObserver.disconnect();
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      scene.destroy();
    };
  }, [reduced]);

  useEffect(() => {
    if (!observeOnly || anchors.length === 0) return;
    const layer = layerRef.current;
    const botsEl = botsRef.current;
    if (!layer || !botsEl) return;

    const nodes = [...botsEl.querySelectorAll<HTMLElement>('[data-bot]')];
    const state = nodes.map((el) => ({
      el,
      x: Number.parseFloat(el.style.left) || 50,
      y: Number.parseFloat(el.style.top) || 50,
    }));

    const apply = (ease: number) => {
      const rect = layer.getBoundingClientRect();
      for (const s of state) {
        const botId = s.el.dataset.bot ?? '';
        const preferred = PREFERRED[botId] ?? [];
        const active = anchors.find((a) => a.id === activeWidgetId);
        const typed = anchors.find((a) => preferred.includes(a.type));
        const target = active ?? typed;
        if (!target || rect.width <= 0) continue;
        const tx = ((target.cx - rect.left) / rect.width) * 100;
        const ty = 72;
        if (ease >= 1) {
          s.x = tx;
          s.y = ty;
        } else {
          s.x += (tx - s.x) * ease;
          s.y += (ty - s.y) * ease;
        }
        s.el.style.left = `${s.x}%`;
        s.el.style.top = `${s.y}%`;
        s.el.style.opacity = '1';
        s.el.style.transform = 'translate(-50%, -50%) scale(1)';
      }
    };

    if (reduced) {
      apply(1);
      return;
    }

    let raf = 0;
    const tick = () => {
      apply(0.08);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [observeOnly, reduced, anchors, activeWidgetId]);

  const setTilt = (clientX: number, clientY: number) => {
    if (reduced) return;
    const rect = layerRef.current?.getBoundingClientRect();
    if (!rect || rect.width < 2) return;
    tiltRef.current = {
      x: (clientX - rect.left) / rect.width * 2 - 1,
      y: (clientY - rect.top) / rect.height * 2 - 1,
    };
  };

  return (
    <section
      className="swarm-panel relative mx-3 mt-2 overflow-hidden rounded-3xl"
      aria-label="Entity swarm in an animated solar system"
    >
      <div className="flex items-center justify-between px-4 pt-3">
        <h2 className="font-display text-sm font-bold uppercase tracking-[0.28em] text-cyan-300">Entity swarm</h2>
        {observeOnly ? (
          <span className="text-[10px] uppercase tracking-widest text-fuchsia-300">Spectator motion</span>
        ) : reduced ? (
          <span className="text-[10px] uppercase tracking-widest text-white/45">Reduced motion</span>
        ) : (
          <span className="text-[10px] uppercase tracking-widest text-white/35">Sol system</span>
        )}
      </div>
      <p className="sr-only">
        Animated solar system with the Sun, Mercury, Venus, Earth and the Moon, Mars, Jupiter and its moons, Saturn,
        Uranus, Neptune, a comet, and meteors. Command Center bots orbit among the planets. Drag across the scene to
        tilt it. Animation holds a single frame when reduced motion is on.
      </p>
      <div
        ref={layerRef}
        className="relative h-[268px]"
        onPointerMove={(event) => setTilt(event.clientX, event.clientY)}
        onPointerLeave={() => {
          tiltRef.current = { x: 0, y: 0 };
        }}
      >
        <canvas ref={canvasRef} className="sol-sky pointer-events-none absolute inset-0" aria-hidden="true" />
        <div ref={botsRef} className="absolute inset-0">
          {BOT_ROSTER.map((bot) => {
            const home = initial.get(bot.id) ?? { x: 50, y: 50 };
            const selected = bot.id === activeBotId;
            return (
              <button
                key={bot.id}
                type="button"
                data-bot={bot.id}
                aria-label={`${bot.name}, ${bot.role}. Set as active bot.`}
                aria-pressed={selected}
                onClick={() => setActiveBot(bot.id)}
                className={cn('sol-bot', selected && 'sol-bot-active')}
                style={{ left: `${home.x}%`, top: `${home.y}%`, transform: 'translate(-50%, -50%)' }}
              >
                <BotAvatar shape={bot.shape} hue={bot.hue} size={selected ? 34 : 28} label={SHORT_LABEL[bot.id] ?? bot.name} pulse={observeOnly && !reduced} />
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
