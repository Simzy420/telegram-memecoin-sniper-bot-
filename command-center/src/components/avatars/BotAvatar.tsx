import type { AvatarHue, AvatarShape } from '@/types/bots';
import { cn } from '@/lib/cn';

const HUE: Record<AvatarHue, { glow: string; core: string; edge: string; ring: string }> = {
  cyan: { glow: '#67e8f9', core: '#22e9ff', edge: '#0891b2', ring: '#22e9ff' },
  purple: { glow: '#e9d5ff', core: '#c084fc', edge: '#6b21a8', ring: '#e879f9' },
  violet: { glow: '#ddd6fe', core: '#8b5cf6', edge: '#4c1d95', ring: '#a78bfa' },
  gold: { glow: '#fde68a', core: '#f5c542', edge: '#b45309', ring: '#fbbf24' },
  green: { glow: '#bbf7d0', core: '#4ade80', edge: '#166534', ring: '#4ade80' },
  magenta: { glow: '#fbcfe8', core: '#e879f9', edge: '#9d174d', ring: '#f472b6' },
};

interface Props {
  shape: AvatarShape;
  hue: AvatarHue;
  size?: number;
  label?: string;
  className?: string;
  pulse?: boolean;
}

export function BotAvatar({ shape, hue, size = 56, label, className, pulse }: Props) {
  const c = HUE[hue];
  const gid = `${shape}-${hue}-${size}`;
  return (
    <div className={cn('flex flex-col items-center gap-1', className)}>
      <div
        className={cn('relative shrink-0', pulse && 'avatar-pulse')}
        style={{ width: size, height: size }}
      >
        {shape === 'sphere' && <SphereSvg colors={c} gid={gid} />}
        {shape === 'pyramid' && <PyramidSvg colors={c} gid={gid} />}
        {shape === 'cube' && <CubeSvg colors={c} gid={gid} />}
      </div>
      {label ? (
        <span className="max-w-[4.8rem] text-center text-[9px] font-semibold uppercase leading-tight tracking-[0.08em] text-cyan-100 drop-shadow-[0_1px_2px_#050816]">
          {label}
        </span>
      ) : null}
    </div>
  );
}

function SphereSvg({
  colors,
  gid,
}: {
  colors: (typeof HUE)[AvatarHue];
  gid: string;
}) {
  return (
    <svg viewBox="0 0 64 64" className="h-full w-full drop-shadow-[0_0_10px_rgba(34,233,255,0.35)]">
      <defs>
        <radialGradient id={`${gid}-core`} cx="42%" cy="32%" r="65%">
          <stop offset="0%" stopColor="#e8feff" />
          <stop offset="35%" stopColor={colors.core} />
          <stop offset="100%" stopColor="#04101c" />
        </radialGradient>
      </defs>
      <ellipse cx="32" cy="32" rx="28" ry="9" fill="none" stroke={colors.ring} strokeWidth="1.6" opacity="0.85" />
      <ellipse
        cx="32"
        cy="32"
        rx="22"
        ry="7"
        fill="none"
        stroke={colors.ring}
        strokeWidth="1"
        opacity="0.4"
        transform="rotate(-18 32 32)"
      />
      <circle cx="32" cy="32" r="16" fill={`url(#${gid}-core)`} stroke={colors.edge} strokeWidth="1.2" />
      <circle cx="26" cy="24" r="4" fill="#fff" opacity="0.35" />
    </svg>
  );
}

function PyramidSvg({
  colors,
  gid,
}: {
  colors: (typeof HUE)[AvatarHue];
  gid: string;
}) {
  return (
    <svg viewBox="0 0 64 64" className="h-full w-full drop-shadow-[0_0_10px_rgba(232,121,249,0.4)]">
      <defs>
        <linearGradient id={`${gid}-py`} x1="50%" y1="0%" x2="50%" y2="100%">
          <stop offset="0%" stopColor={colors.glow} />
          <stop offset="55%" stopColor={colors.core} />
          <stop offset="100%" stopColor={colors.edge} />
        </linearGradient>
      </defs>
      <polygon points="32,6 58,54 6,54" fill={`url(#${gid}-py)`} stroke={colors.glow} strokeWidth="1.4" />
      <polygon points="32,16 46,48 18,48" fill="none" stroke={colors.glow} strokeWidth="1.2" opacity="0.9" />
      <polygon points="32,22 40,44 24,44" fill={colors.edge} opacity="0.45" />
      <polygon points="32,6 32,54 6,54" fill="#000" opacity="0.18" />
    </svg>
  );
}

function CubeSvg({
  colors,
  gid,
}: {
  colors: (typeof HUE)[AvatarHue];
  gid: string;
}) {
  return (
    <svg viewBox="0 0 64 64" className="h-full w-full drop-shadow-[0_0_10px_rgba(167,139,250,0.45)]">
      <defs>
        <linearGradient id={`${gid}-c`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={colors.glow} />
          <stop offset="100%" stopColor={colors.edge} />
        </linearGradient>
      </defs>
      <g transform="translate(8 10)">
        <polygon points="24,0 48,12 24,24 0,12" fill={`url(#${gid}-c)`} opacity="0.95" />
        <polygon points="0,12 24,24 24,48 0,36" fill={colors.edge} />
        <polygon points="24,24 48,12 48,36 24,48" fill={colors.core} />
        <path
          d="M24 4 L30 16 L18 20 L28 28 L16 32 L26 40"
          fill="none"
          stroke={colors.glow}
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path
          d="M8 18 L20 22 L10 30 L22 34"
          fill="none"
          stroke={colors.ring}
          strokeWidth="1.2"
          opacity="0.8"
        />
      </g>
    </svg>
  );
}
