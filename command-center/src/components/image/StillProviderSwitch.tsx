import { cn } from '@/lib/cn';
import { useImageStore } from '@/store/imageStore';

export function StillProviderSwitch({ className }: { className?: string }) {
  const provider = useImageStore((s) => s.stillProvider);
  const setStillProvider = useImageStore((s) => s.setStillProvider);

  return (
    <div className={cn('grid grid-cols-2 gap-2', className)} role="group" aria-label="Still image provider">
      <button
        type="button"
        aria-pressed={provider === 'pollinations'}
        className={cn(
          'hud-btn-ghost min-h-[48px] whitespace-normal px-2 text-center text-[11px] leading-tight',
          provider === 'pollinations' && 'hud-btn-primary',
        )}
        onClick={() => setStillProvider('pollinations')}
      >
        Pollinations (free)
      </button>
      <button
        type="button"
        aria-pressed={provider === 'openai'}
        className={cn('hud-btn-ghost min-h-[48px] text-sm', provider === 'openai' && 'hud-btn-primary')}
        onClick={() => setStillProvider('openai')}
      >
        OpenAI
      </button>
    </div>
  );
}
