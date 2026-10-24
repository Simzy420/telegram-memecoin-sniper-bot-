import { MAX_FILE_CHARS } from '../../store/fileDocument.ts';

export interface OpenLocalFile {
  name: string;
  content: string;
}

export interface OpenLocalResult {
  opened: OpenLocalFile[];
  skipped: number;
  message: string;
}

const TEXT_NAME =
  /\.(txt|md|markdown|json|csv|tsv|log|xml|html?|css|js|ts|tsx|jsx|py|sh|ya?ml|toml|ini|env|sql|r|rb|go|rs|java|c|cc|cpp|h|hpp|swift|kt|dart|vue|svelte)$/i;

/** Images and videos belong in Photo gallery, even when the phone omits a MIME type. */
const MEDIA_NAME = /\.(mp4|webm|mov|m4v|mkv|avi|png|jpe?g|gif|webp|heic|heif|bmp|svg|mp3|wav|m4a|aac)$/i;

/** Keep downloaded / device picks as plain text notes in Files. */
export function isLikelyTextFile(file: { name: string; type: string }): boolean {
  if (MEDIA_NAME.test(file.name)) return false;
  const type = (file.type || '').toLowerCase();
  if (type.startsWith('image/') || type.startsWith('video/') || type.startsWith('audio/')) return false;
  if (type.startsWith('text/')) return true;
  if (
    type === 'application/json' ||
    type === 'application/xml' ||
    type === 'application/javascript' ||
    type === 'application/typescript' ||
    type === 'application/x-javascript' ||
    type === 'application/sql' ||
    type === 'application/yaml' ||
    type === 'application/x-yaml' ||
    type === ''
  ) {
    return true;
  }
  return TEXT_NAME.test(file.name);
}

export function openLocalResultMessage(opened: number, skipped: number): string {
  if (opened === 0) {
    return skipped
      ? 'No files opened. Pick text downloads under the size limit, or use Photo gallery for images and videos.'
      : 'No files selected.';
  }
  if (skipped) {
    return `Opened ${opened}. Skipped ${skipped} unsupported or oversized file${skipped === 1 ? '' : 's'}.`;
  }
  return opened === 1 ? 'Opened from this device’s downloads.' : `Opened ${opened} files from this device’s downloads.`;
}

/**
 * Reads picks from the phone file picker (Downloads / Recents / Files).
 * Files stay on this device as text notes — nothing is uploaded.
 */
export async function readLocalTextFiles(files: FileList | File[] | null | undefined): Promise<OpenLocalResult> {
  const list = files ? Array.from(files) : [];
  if (!list.length) {
    return { opened: [], skipped: 0, message: openLocalResultMessage(0, 0) };
  }

  const opened: OpenLocalFile[] = [];
  let skipped = 0;

  for (const file of list) {
    const name = file.name?.trim();
    if (!name || !isLikelyTextFile(file)) {
      skipped += 1;
      continue;
    }
    if (typeof file.size === 'number' && file.size > MAX_FILE_CHARS) {
      skipped += 1;
      continue;
    }
    try {
      const content = await file.text();
      if (content.length > MAX_FILE_CHARS) {
        skipped += 1;
        continue;
      }
      opened.push({ name, content });
    } catch {
      skipped += 1;
    }
  }

  return {
    opened,
    skipped,
    message: openLocalResultMessage(opened.length, skipped),
  };
}
