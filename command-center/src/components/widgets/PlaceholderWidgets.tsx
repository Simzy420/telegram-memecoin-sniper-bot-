import { WidgetFrame } from '@/components/shell/WidgetFrame';
import type { WidgetRenderProps } from '@/registry/types';

export function TradingStubWidget({ widget }: WidgetRenderProps) {
  return (
    <WidgetFrame widget={widget} title="Trading" badge="FLAG">
      <EmptyDataSource label="Trading" detail="Observe only · no live orders. This stub stays empty until a real data source is connected." />
    </WidgetFrame>
  );
}

function EmptyDataSource({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="flex h-full min-h-[8rem] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-amber-300/30 bg-black/20 px-4 text-center">
      <p className="font-display text-sm uppercase tracking-[0.2em] text-amber-200">Connect data source</p>
      <p className="text-sm leading-relaxed text-white/55">{detail}</p>
      <p className="font-mono text-[10px] text-white/30">{label} · no simulated feed</p>
    </div>
  );
}
