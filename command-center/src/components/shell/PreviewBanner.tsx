import { useSessionStore } from '@/store/sessionStore';

export function PreviewBanner() {
  const plan = useSessionStore((s) => s.plan);
  const setPlan = useSessionStore((s) => s.setPlan);
  if (plan !== 'guest') return null;
  return (
    <div className="relative z-20 flex items-center justify-between gap-3 bg-gradient-to-r from-fuchsia-700/80 to-amber-600/70 px-3 py-2 text-sm">
      <p className="font-medium">Preview mode — upgrade to save</p>
      <button type="button" className="rounded-full bg-black/40 px-3 py-1 text-xs uppercase tracking-wider" onClick={() => setPlan('owner')}>
        Upgrade stub
      </button>
    </div>
  );
}
