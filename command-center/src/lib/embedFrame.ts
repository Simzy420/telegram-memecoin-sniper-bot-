interface EmbedFrame {
  contentDocument: { location?: { href?: string } } | null;
  contentWindow: object | null;
}

/**
 * A framed page that loaded cross-origin throws (or hides the document) when read.
 * A host that refuses the frame leaves an accessible about:blank document.
 */
export function embedFrameAccepted(frame: EmbedFrame): boolean {
  try {
    const doc = frame.contentDocument;
    if (doc == null) return frame.contentWindow != null;
    const href = doc.location?.href ?? '';
    return href !== '' && href !== 'about:blank';
  } catch {
    return true;
  }
}
