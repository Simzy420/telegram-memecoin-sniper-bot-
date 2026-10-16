export type SendKind = 'share-file' | 'share-url' | 'share-text' | 'download';

export interface SendCapabilities {
  canShareFiles: boolean;
  canShareUrl: boolean;
  canShareText: boolean;
}

export function isRemoteHttpUrl(value: string): boolean {
  const text = value.trim();
  if (!text || /\s/.test(text)) return false;
  try {
    const url = new URL(text);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/** Prefer a real share-sheet handoff. Download only when this browser cannot share. */
export function chooseSendKind(content: string, caps: SendCapabilities): SendKind {
  if (isRemoteHttpUrl(content) && caps.canShareUrl) return 'share-url';
  if (!isRemoteHttpUrl(content) && caps.canShareFiles) return 'share-file';
  if (!isRemoteHttpUrl(content) && caps.canShareText) return 'share-text';
  return 'download';
}

export function sendResultMessage(kind: SendKind, remote: boolean): string {
  if (kind === 'share-file' || kind === 'share-text') {
    return 'Sent to this phone’s share sheet. Choose Messages, Mail, AirDrop, or another app there.';
  }
  if (kind === 'share-url') {
    return 'Sent the link to this phone’s share sheet. The clip stays at that address; pick an app on the sheet to pass it on.';
  }
  if (remote) {
    return 'Downloaded a text file with the link into this browser’s downloads. This browser has no share sheet, and the clip itself stays at that address.';
  }
  return 'Downloaded the file into this browser’s downloads. This browser has no share sheet.';
}

export function downloadName(name: string, remote: boolean): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim() || 'note';
  if (remote) return /\.txt$/i.test(cleaned) ? cleaned : `${cleaned}.txt`;
  if (/\.[A-Za-z0-9]{1,8}$/.test(cleaned)) return cleaned;
  return `${cleaned}.txt`;
}

export function shareWasCanceled(err: unknown): boolean {
  return typeof err === 'object' && err != null && 'name' in err && (err as { name?: string }).name === 'AbortError';
}

function canShare(data: ShareData): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return false;
  if (typeof navigator.canShare !== 'function') return false;
  try {
    return navigator.canShare(data);
  } catch {
    return false;
  }
}

function download(name: string, body: string): void {
  const blob = new Blob([body], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Hands the file off this app. A share sheet leaves it with whatever app Casey picks.
 * With no share sheet, the file is downloaded in this browser. Nothing is uploaded.
 */
export async function handOffFile(file: { name: string; content: string }): Promise<{ canceled: boolean; message: string }> {
  const content = file.content ?? '';
  const remote = isRemoteHttpUrl(content);
  const named = downloadName(file.name, remote);
  const payload = remote ? content.trim() : content;
  const sharedFile = new File([payload], downloadName(file.name, false), { type: 'text/plain' });
  const kind = chooseSendKind(content, {
    canShareFiles: canShare({ files: [sharedFile] }),
    canShareUrl: remote && canShare({ url: content.trim(), title: file.name }),
    canShareText: canShare({ text: content, title: file.name }),
  });

  try {
    if (kind === 'share-url') {
      await navigator.share({ url: content.trim(), title: file.name });
    } else if (kind === 'share-file') {
      await navigator.share({ files: [sharedFile], title: file.name });
    } else if (kind === 'share-text') {
      await navigator.share({ text: content, title: file.name });
    } else {
      download(named, payload);
    }
  } catch (err) {
    if (shareWasCanceled(err)) return { canceled: true, message: 'Send canceled.' };
    download(named, payload);
    return { canceled: false, message: sendResultMessage('download', remote) };
  }
  return { canceled: false, message: sendResultMessage(kind, remote) };
}
