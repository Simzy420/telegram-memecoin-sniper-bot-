import { useState } from 'react';
import { shouldUseImageProxy } from '@/adapters/imagegen';
import { cn } from '@/lib/cn';
import { useVaultStore } from '@/store/vaultStore';

/** Device-only OpenAI key field. Render this only while the OpenAI stills provider is selected. */
export function OpenAiKeyFields({ framed = true }: { framed?: boolean }) {
  const hasKey = useVaultStore((s) => s.hasKey);
  const hint = useVaultStore((s) => s.hint);
  const saveKey = useVaultStore((s) => s.saveKey);
  const clearKey = useVaultStore((s) => s.clearKey);
  const [draft, setDraft] = useState('');
  const [msg, setMsg] = useState('');
  const proxy = shouldUseImageProxy();

  return (
    <div className={cn(framed && 'mb-3 rounded-2xl border border-white/10 p-3', 'space-y-2 text-sm text-white/70')}>
      <p>
        {proxy
          ? 'This host uses a server-side OpenAI key. A pasted key stays on this device for other hosts.'
          : hasKey
            ? `OpenAI key on this device ${hint}`
            : 'Paste an OpenAI key to generate with OpenAI.'}
      </p>
      <input
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setMsg('');
        }}
        placeholder="Paste OpenAI API key"
        className="hud-input w-full"
        aria-label="OpenAI API key"
      />
      <div className="flex gap-2">
        <button
          type="button"
          className="hud-btn-primary flex-1"
          onClick={() => {
            if (saveKey(draft)) {
              setDraft('');
              setMsg('Saved on this device only.');
            } else {
              setMsg('Paste a key first.');
            }
          }}
        >
          Save
        </button>
        <button
          type="button"
          className="hud-btn-ghost flex-1"
          onClick={() => {
            clearKey();
            setDraft('');
            setMsg('Cleared from this device.');
          }}
        >
          Clear
        </button>
      </div>
      {msg ? <p className="text-xs text-cyan-200/80">{msg}</p> : null}
      <p className="font-mono text-[11px] leading-relaxed text-white/40">
        Never sent to git. Stored in this browser only. Do not screenshot this field.
      </p>
    </div>
  );
}
