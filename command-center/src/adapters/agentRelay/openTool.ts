/**
 * Phone-first open path for Agent Relay:
 * 1) copy the handoff brief
 * 2) try iOS share sheet when available
 * 3) open the tool URL in a new tab
 */
export async function openToolWithHandoff(opts: {
  url: string;
  paste: string;
  title: string;
}): Promise<{ copied: boolean; shared: boolean; opened: boolean }> {
  let copied = false;
  let shared = false;
  let opened = false;

  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(opts.paste);
      copied = true;
    }
  } catch {
    copied = false;
  }

  // Prefer clipboard for paste-into-chat flows. Share is optional and often
  // better as an explicit button — auto-share can interrupt iPhone Safari.
  if (typeof window !== 'undefined') {
    const win = window.open(opts.url, '_blank', 'noopener,noreferrer');
    opened = win != null;
    if (!opened) {
      // Popup blocked — navigate top-level as a last resort on phones.
      window.location.assign(opts.url);
      opened = true;
    }
  }

  return { copied, shared, opened };
}

export async function shareHandoff(opts: { title: string; paste: string }): Promise<boolean> {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return false;
  try {
    await navigator.share({ title: opts.title, text: opts.paste });
    return true;
  } catch {
    return false;
  }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
