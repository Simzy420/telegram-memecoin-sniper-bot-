import type { CSSProperties, ReactNode } from 'react';
import { GripVertical, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useProfileStore } from '@/store/profileStore';
import { useSessionStore } from '@/store/sessionStore';
import type { WidgetInstance } from '@/types/layout';

const ACCENT: Record<string, string> = {
  chat: 'accent-mag',
  files: 'accent-cyan',
  todo: 'accent-cyan',
  links: 'accent-cyan',
  imagegen: 'accent-mag',
  gallery: 'accent-mag',
  watchlist: 'accent-gold',
  robinhood: 'accent-gold',
  compute: 'accent-gold',
  gmail: 'accent-cyan',
  game: 'accent-mag',
  drive: 'accent-cyan',
  trading: 'accent-gold',
};

interface Props {
  widget: WidgetInstance;
  title: string;
  badge?: string;
  /** When set, the title keeps this face instead of the display font. */
  titleStyle?: CSSProperties;
  children: ReactNode;
  footer?: ReactNode;
}

export function WidgetFrame({ widget, title, badge = 'LIVE', titleStyle, children, footer }: Props) {
  const mode = useSessionStore((s) => s.mode);
  const setActiveWidget = useSessionStore((s) => s.setActiveWidget);
  const removeWidget = useProfileStore((s) => s.removeWidget);
  const accent = ACCENT[widget.type] ?? 'accent-cyan';

  return (
    <section
      data-widget-id={widget.id}
      data-widget-type={widget.type}
      onPointerDown={() => setActiveWidget(widget.id)}
      className={cn(
        'widget-card flex h-full min-h-0 flex-col overflow-hidden',
        accent,
        mode === 'edit' && 'widget-card-edit',
      )}
    >
      <header
        className={cn(
          'widget-chrome flex shrink-0 items-center gap-2 px-3 py-2',
          mode === 'edit' && 'widget-drag-handle cursor-grab active:cursor-grabbing',
        )}
      >
        {mode === 'edit' ? <GripVertical className="h-4 w-4 text-cyan-200/70" /> : null}
        <h3
          className={
            titleStyle
              ? 'text-[1.35rem] leading-none text-white'
              : 'font-display text-[13px] font-bold uppercase tracking-[0.18em] text-white'
          }
          style={titleStyle}
        >
          {title}
        </h3>
        <span className="ml-auto rounded-full border border-amber-300/40 bg-amber-400/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-amber-200">
          {badge}
        </span>
        {mode === 'edit' ? (
          <button
            type="button"
            className="widget-no-drag rounded-md p-1 text-white/60 hover:bg-white/10 hover:text-white"
            aria-label="Remove widget"
            onClick={(e) => {
              e.stopPropagation();
              removeWidget(widget.id);
            }}
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </header>
      <div className="widget-body min-h-0 flex-1 overflow-y-auto px-3 pb-3">{children}</div>
      {footer ? <div className="shrink-0 border-t border-white/10 px-3 py-2">{footer}</div> : null}
    </section>
  );
}
