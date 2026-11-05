import {
  DRIVE_ACCOUNT,
  PUBLIC_CLOSED_MESSAGE,
  UNREACHABLE_MESSAGE,
  capDriveFiles,
  driveRequestsAllowed,
  isDriveFileId,
  normalizeDriveFile,
  type DriveFile,
  type DriveFileSummary,
} from './policy';

export class DriveClosedError extends Error {
  readonly closed = true;

  constructor(message: string) {
    super(message);
    this.name = 'DriveClosedError';
  }
}

export class DriveUnreachableError extends Error {
  readonly unreachable = true;

  constructor(message = UNREACHABLE_MESSAGE) {
    super(message);
    this.name = 'DriveUnreachableError';
  }
}

export class DriveNeedsPasswordError extends Error {
  readonly needsPassword = true;

  constructor(message: string) {
    super(message);
    this.name = 'DriveNeedsPasswordError';
  }
}

export function assertPrivateDriveHost(hostname: string): void {
  if (!driveRequestsAllowed(hostname)) {
    throw new DriveClosedError(PUBLIC_CLOSED_MESSAGE);
  }
}

async function requestJson(
  hostname: string,
  path: string,
  init?: RequestInit,
): Promise<Record<string, unknown>> {
  assertPrivateDriveHost(hostname);
  let response: Response;
  try {
    response = await fetch(path, { ...init, credentials: 'same-origin', cache: 'no-store' });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new DriveUnreachableError();
  }
  const data: unknown = await response.json().catch(() => ({}));
  const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  if (response.status === 401 || record.needsPassword === true) {
    const message = typeof record.error === 'string' && record.error.trim()
      ? record.error
      : 'Enter the Command Center password.';
    throw new DriveNeedsPasswordError(message);
  }
  if (record.closed === true) {
    const message = typeof record.error === 'string' && record.error.trim() ? record.error : PUBLIC_CLOSED_MESSAGE;
    throw new DriveClosedError(message);
  }
  if (!response.ok) {
    const message = typeof record.error === 'string' && record.error.trim()
      ? record.error
      : `Drive request failed (${response.status}).`;
    throw new Error(message);
  }
  if (record.account != null && record.account !== DRIVE_ACCOUNT) {
    throw new Error('This board only opens caseylsims@gmail.com.');
  }
  return record;
}

export async function loadDriveSession(hostname: string, signal?: AbortSignal): Promise<void> {
  await requestJson(hostname, '/api/drive/session', { signal, headers: { Accept: 'application/json' } });
}

export async function lockDriveSession(hostname: string): Promise<void> {
  if (!driveRequestsAllowed(hostname)) return;
  try {
    await fetch('/api/drive/session', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ lock: true }),
    });
  } catch {
    /* Leaving a profile still drops the local session even if the lock request fails. */
  }
}

export async function unlockDrive(hostname: string, password: string): Promise<void> {
  await requestJson(hostname, '/api/drive/session', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
}

export async function loadDriveFiles(
  hostname: string,
  signal?: AbortSignal,
): Promise<{ account: string; files: DriveFileSummary[] }> {
  const data = await requestJson(hostname, '/api/drive/files', { signal, headers: { Accept: 'application/json' } });
  const rows = Array.isArray(data.files) ? data.files : [];
  const files = capDriveFiles(rows.map(normalizeDriveFile).filter((row): row is DriveFileSummary => row != null));
  return { account: DRIVE_ACCOUNT, files };
}

export async function loadDriveFile(hostname: string, id: string, signal?: AbortSignal): Promise<DriveFile> {
  if (!isDriveFileId(id)) throw new Error('Unknown Drive file.');
  const data = await requestJson(hostname, `/api/drive/files/${id}`, {
    signal,
    headers: { Accept: 'application/json' },
  });
  const summary = normalizeDriveFile(data.file);
  const raw = data.file;
  const content = raw && typeof raw === 'object' && typeof (raw as { content?: unknown }).content === 'string'
    ? (raw as { content: string }).content
    : '';
  if (!summary) throw new Error('That Drive file is not in the newest list.');
  return { ...summary, content };
}

export async function createDriveFile(
  hostname: string,
  draft: { name: string; content: string },
): Promise<DriveFile> {
  const data = await requestJson(hostname, '/api/drive/files', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: draft.name, content: draft.content }),
  });
  const summary = normalizeDriveFile(data.file);
  if (!summary) throw new Error('Google Drive did not return the new file.');
  return { ...summary, content: draft.content, writable: true };
}

export async function updateDriveFile(
  hostname: string,
  id: string,
  content: string,
): Promise<DriveFile> {
  if (!isDriveFileId(id)) throw new Error('Unknown Drive file.');
  const data = await requestJson(hostname, `/api/drive/files/${id}`, {
    method: 'PUT',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  const summary = normalizeDriveFile(data.file);
  if (!summary) throw new Error('Google Drive did not return the updated file.');
  return { ...summary, content, writable: true };
}
