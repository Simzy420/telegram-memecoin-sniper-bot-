import { normalizeHost } from '../gmail/policy.ts';

/** Hosts with no Drive server. The Vercel site is allowed and checks the password there. */
const STATIC_HOST_SUFFIXES = [
  'github.io',
  'githubusercontent.com',
  'github.com',
  'hf.space',
  'huggingface.co',
  'netlify.app',
  'pages.dev',
];

/** Locked Drive account. The phone never chooses another Google account. */
export const DRIVE_ACCOUNT = 'caseylsims@gmail.com';

export const DRIVE_LIST_LIMIT = 25;

/** Full Drive scope. drive.file cannot list files this app did not create. */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';

/** Keep the words “Google Drive” in the display face without forcing uppercase. */
export const DRIVE_TITLE_STYLE = {
  fontFamily: '"Orbitron", sans-serif',
  textTransform: 'none' as const,
  letterSpacing: '0.02em',
  fontWeight: 700,
};

export const PUBLIC_CLOSED_MESSAGE =
  'Google Drive does not load on this host. Open the Vercel site and unlock the Google Drive section there. GitHub Pages and the chat Space do not list, save, or send Drive files.';

export const UNREACHABLE_MESSAGE =
  'Google Drive did not answer on this host. On the Vercel project, set COMMAND_CENTER_PASSWORD, GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, and GOOGLE_DRIVE_REFRESH_TOKEN. Those values stay on the server.';

const FILE_ID = /^[A-Za-z0-9_-]{8,200}$/;

export interface DriveFileSummary {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  writable: boolean;
}

export interface DriveFile extends DriveFileSummary {
  content: string;
}

export function driveRequestsAllowed(hostname: string): boolean {
  const host = normalizeHost(hostname);
  if (!host) return false;
  return !STATIC_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

export function isDriveFileId(value: string): boolean {
  return FILE_ID.test(value);
}

export function normalizeDriveFile(value: unknown): DriveFileSummary | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const id = typeof row.id === 'string' ? row.id : '';
  if (!isDriveFileId(id)) return null;
  return {
    id,
    name: typeof row.name === 'string' && row.name.trim() ? row.name : 'Untitled',
    mimeType: typeof row.mimeType === 'string' ? row.mimeType : '',
    modifiedTime: typeof row.modifiedTime === 'string' ? row.modifiedTime : '',
    writable: row.writable === true,
  };
}

export function capDriveFiles(files: DriveFileSummary[]): DriveFileSummary[] {
  return files.slice(0, DRIVE_LIST_LIMIT);
}
