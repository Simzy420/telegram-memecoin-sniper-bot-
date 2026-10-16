export type DownloadsPlatform = 'ios' | 'android' | 'other';

/** iCloud Drive → Downloads in the Files app (where Safari often lands downloads). */
export const IOS_ICLOUD_DOWNLOADS_URL =
  'shareddocuments:///private/var/mobile/Library/Mobile%20Documents/com~apple~CloudDocs/Downloads';

/** Opens the Files app when a folder path is unavailable. */
export const IOS_FILES_APP_URL = 'shareddocuments://';

/** Android primary storage Download folder via the document provider. */
export const ANDROID_DOWNLOADS_URL =
  'content://com.android.externalstorage.documents/document/primary%3ADownload';

export function detectDownloadsPlatform(ua: string, maxTouchPoints = 0): DownloadsPlatform {
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  // iPadOS Safari identifies as Macintosh. A touch screen distinguishes it from a desktop Mac.
  if (/Macintosh/i.test(ua) && maxTouchPoints > 1) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'other';
}

export function downloadsOpenTargets(platform: DownloadsPlatform): string[] {
  if (platform === 'ios') return [IOS_ICLOUD_DOWNLOADS_URL, IOS_FILES_APP_URL];
  if (platform === 'android') return [ANDROID_DOWNLOADS_URL];
  return [];
}

export function downloadsOpenMessage(platform: DownloadsPlatform, opened: boolean): string {
  if (opened && platform === 'ios') {
    return 'Opened Downloads in the Files app. If that folder is empty, check On My iPhone → Downloads.';
  }
  if (opened && platform === 'android') {
    return 'Opened the Download folder.';
  }
  if (platform === 'ios') {
    return 'Could not open Files from here. On this phone open Files → Downloads for anything Send saved there.';
  }
  if (platform === 'android') {
    return 'Could not open Download from here. Open Files or Downloads on this phone for anything Send saved there.';
  }
  return 'On a phone, this opens the Files app Downloads folder. On this computer, open your browser’s downloads instead.';
}

/**
 * Hands off to the phone’s Files / Downloads app.
 * Custom schemes cannot be probed from the web, so the first target is attempted.
 */
export function openDeviceDownloads(opts: {
  userAgent: string;
  maxTouchPoints?: number;
  openUrl: (url: string) => boolean;
}): { opened: boolean; message: string } {
  const platform = detectDownloadsPlatform(opts.userAgent, opts.maxTouchPoints ?? 0);
  const targets = downloadsOpenTargets(platform);
  if (targets.length === 0) {
    return { opened: false, message: downloadsOpenMessage(platform, false) };
  }
  for (const url of targets) {
    if (opts.openUrl(url)) {
      return { opened: true, message: downloadsOpenMessage(platform, true) };
    }
  }
  return { opened: false, message: downloadsOpenMessage(platform, false) };
}

/** Best-effort open for custom schemes (Files app) and content URIs. */
export function openExternalUrl(url: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const popup = window.open(url, '_blank', 'noopener,noreferrer');
    if (popup) return true;
    window.location.assign(url);
    return true;
  } catch {
    return false;
  }
}
