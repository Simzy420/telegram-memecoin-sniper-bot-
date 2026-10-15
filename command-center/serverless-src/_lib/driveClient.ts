export const DRIVE_ACCOUNT = 'caseylsims@gmail.com';
export const DRIVE_LIST_LIMIT = 25;
const MAX_CONTENT = 100_000;
const FILE_ID_RE = /^[A-Za-z0-9_-]{8,200}$/;
const TEXT_MIME = new Set([
  'application/json',
  'application/javascript',
  'application/csv',
  'text/csv',
  'application/xml',
  'text/xml',
]);
const EXPORT_MIME: Record<string, string> = {
  'application/vnd.google-apps.document': 'text/plain',
  'application/vnd.google-apps.spreadsheet': 'text/csv',
  'application/vnd.google-apps.presentation': 'text/plain',
};

export class DriveGatewayError extends Error {}
export class DriveInputError extends Error {}

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

export interface DriveGateway {
  listFiles(): Promise<DriveFileSummary[]>;
  readFile(id: string): Promise<DriveFile>;
  createFile(name: string, content: string): Promise<DriveFile>;
  updateFile(id: string, content: string): Promise<DriveFile>;
}

type Transport = (
  method: string,
  url: string,
  headers: Record<string, string>,
  body?: Uint8Array,
) => Promise<{ status: number; body: Uint8Array }>;

export function googleConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_DRIVE_CLIENT_ID
    && process.env.GOOGLE_DRIVE_CLIENT_SECRET
    && process.env.GOOGLE_DRIVE_REFRESH_TOKEN,
  );
}

function writable(mime: string): boolean {
  const lowered = mime.toLowerCase();
  return lowered.startsWith('text/') || TEXT_MIME.has(lowered);
}

function cleanName(name: unknown): string {
  if (typeof name !== 'string') throw new DriveInputError('Name the file first.');
  const cleaned = name.trim();
  if (!cleaned || cleaned.length > 200 || /[\r\n\u0000/\\]/.test(cleaned)) {
    throw new DriveInputError('Use a plain file name.');
  }
  return cleaned;
}

function cleanContent(content: unknown): string {
  if (typeof content !== 'string' || content.includes('\u0000')) {
    throw new DriveInputError('File contents must be text.');
  }
  if (content.length > MAX_CONTENT) throw new DriveInputError('This file is too long to write to Drive.');
  return content;
}

async function defaultTransport(
  method: string,
  url: string,
  headers: Record<string, string>,
  body?: Uint8Array,
): Promise<{ status: number; body: Uint8Array }> {
  const response = await fetch(url, { method, headers, body: body ? Buffer.from(body) : undefined });
  return { status: response.status, body: new Uint8Array(await response.arrayBuffer()) };
}

export class GoogleDriveGateway implements DriveGateway {
  private access = '';
  private readonly transport: Transport;

  constructor(transport: Transport = defaultTransport) {
    this.transport = transport;
  }

  private async request(method: string, url: string, headers: Record<string, string> = {}, body?: Uint8Array, auth = true) {
    const sent = { ...headers };
    if (auth) sent.Authorization = `Bearer ${await this.accessToken()}`;
    const result = await this.transport(method, url, sent, body);
    if (result.status >= 400) {
      if (result.status === 401 || result.status === 403) {
        throw new DriveGatewayError('Google refused the Drive login. Check the OAuth refresh token on the server.');
      }
      throw new DriveGatewayError('The Drive server could not complete that request.');
    }
    return result.body;
  }

  private async accessToken(): Promise<string> {
    if (this.access) return this.access;
    if (!googleConfigured()) throw new DriveGatewayError('Google Drive is not configured on the server.');
    const form = new URLSearchParams({
      client_id: process.env.GOOGLE_DRIVE_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_DRIVE_CLIENT_SECRET ?? '',
      refresh_token: process.env.GOOGLE_DRIVE_REFRESH_TOKEN ?? '',
      grant_type: 'refresh_token',
    });
    const result = await this.transport(
      'POST',
      'https://oauth2.googleapis.com/token',
      { 'Content-Type': 'application/x-www-form-urlencoded' },
      new TextEncoder().encode(form.toString()),
    );
    let data: unknown;
    try {
      data = JSON.parse(new TextDecoder().decode(result.body));
    } catch {
      throw new DriveGatewayError('Google did not return a Drive access token.');
    }
    const token = data && typeof data === 'object' ? (data as { access_token?: unknown }).access_token : '';
    if (result.status >= 400 || typeof token !== 'string' || !token) {
      throw new DriveGatewayError('Google refused the Drive login. Check the OAuth refresh token on the server.');
    }
    this.access = token;
    return token;
  }

  private async assertAccount(): Promise<void> {
    const payload = await this.request('GET', 'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)');
    const data = JSON.parse(new TextDecoder().decode(payload)) as { user?: { emailAddress?: string } };
    if ((data.user?.emailAddress ?? '').toLowerCase() !== DRIVE_ACCOUNT) {
      throw new DriveGatewayError(`This Drive bridge only opens ${DRIVE_ACCOUNT}.`);
    }
  }

  async listFiles(): Promise<DriveFileSummary[]> {
    await this.assertAccount();
    const query = new URLSearchParams({
      pageSize: String(DRIVE_LIST_LIMIT),
      orderBy: 'modifiedTime desc',
      q: "trashed = false and mimeType != 'application/vnd.google-apps.folder'",
      fields: 'files(id,name,mimeType,modifiedTime)',
      spaces: 'drive',
    });
    const payload = await this.request('GET', `https://www.googleapis.com/drive/v3/files?${query}`);
    const data = JSON.parse(new TextDecoder().decode(payload)) as { files?: unknown[] };
    const rows = Array.isArray(data.files) ? data.files : [];
    const files: DriveFileSummary[] = [];
    for (const row of rows.slice(0, DRIVE_LIST_LIMIT)) {
      if (!row || typeof row !== 'object') continue;
      const item = row as { id?: unknown; name?: unknown; mimeType?: unknown; modifiedTime?: unknown };
      const id = typeof item.id === 'string' ? item.id : '';
      if (!FILE_ID_RE.test(id)) continue;
      const mime = typeof item.mimeType === 'string' ? item.mimeType : '';
      files.push({
        id,
        name: typeof item.name === 'string' && item.name ? item.name : 'Untitled',
        mimeType: mime,
        modifiedTime: typeof item.modifiedTime === 'string' ? item.modifiedTime : '',
        writable: writable(mime),
      });
    }
    return files;
  }

  async readFile(id: string): Promise<DriveFile> {
    if (!FILE_ID_RE.test(id)) throw new DriveInputError('Unknown Drive file.');
    await this.assertAccount();
    const meta = await this.metadata(id);
    const mime = String(meta.mimeType ?? '');
    const exportMime = EXPORT_MIME[mime];
    let url: string;
    if (exportMime) {
      url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}/export?${new URLSearchParams({ mimeType: exportMime })}`;
    } else if (mime === 'application/vnd.google-apps.folder') {
      throw new DriveInputError('That Drive item is a folder.');
    } else if (writable(mime) || mime.startsWith('text/') || !mime) {
      url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`;
    } else {
      throw new DriveInputError('This Drive file is not text, so its contents are not shown here.');
    }
    const payload = await this.request('GET', url);
    if (payload.slice(0, 1024).includes(0)) {
      throw new DriveInputError('This Drive file is not text, so its contents are not shown here.');
    }
    let text = new TextDecoder().decode(payload);
    if (text.length > MAX_CONTENT) text = text.slice(0, MAX_CONTENT);
    return {
      id,
      name: String(meta.name ?? 'Untitled'),
      mimeType: mime,
      modifiedTime: String(meta.modifiedTime ?? ''),
      content: text,
      writable: writable(mime),
    };
  }

  async createFile(name: string, content: string): Promise<DriveFile> {
    const cleaned = cleanName(name);
    const body = cleanContent(content);
    await this.assertAccount();
    const payload = await this.request(
      'POST',
      'https://www.googleapis.com/drive/v3/files',
      { 'Content-Type': 'application/json' },
      new TextEncoder().encode(JSON.stringify({ name: cleaned, mimeType: 'text/plain' })),
    );
    const created = JSON.parse(new TextDecoder().decode(payload)) as { id?: string };
    const id = created.id ?? '';
    if (!FILE_ID_RE.test(id)) throw new DriveGatewayError('Google Drive did not return a file id.');
    await this.upload(id, body);
    return { id, name: cleaned, mimeType: 'text/plain', modifiedTime: '', content: body, writable: true };
  }

  async updateFile(id: string, content: string): Promise<DriveFile> {
    if (!FILE_ID_RE.test(id)) throw new DriveInputError('Unknown Drive file.');
    const body = cleanContent(content);
    await this.assertAccount();
    const meta = await this.metadata(id);
    const mime = String(meta.mimeType ?? '');
    if (!writable(mime)) {
      throw new DriveInputError('This Google file is shown as text, but Save cannot overwrite it. Save a new text file instead.');
    }
    await this.upload(id, body);
    return {
      id,
      name: String(meta.name ?? 'Untitled'),
      mimeType: mime,
      modifiedTime: String(meta.modifiedTime ?? ''),
      content: body,
      writable: true,
    };
  }

  private async metadata(id: string): Promise<{ name?: string; mimeType?: string; modifiedTime?: string }> {
    const payload = await this.request(
      'GET',
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=id,name,mimeType,modifiedTime`,
    );
    const data = JSON.parse(new TextDecoder().decode(payload));
    if (!data || typeof data !== 'object') throw new DriveGatewayError('Google Drive did not return that file.');
    return data as { name?: string; mimeType?: string; modifiedTime?: string };
  }

  private async upload(id: string, content: string): Promise<void> {
    await this.request(
      'PATCH',
      `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(id)}?uploadType=media`,
      { 'Content-Type': 'text/plain; charset=utf-8' },
      new TextEncoder().encode(content),
    );
  }
}
