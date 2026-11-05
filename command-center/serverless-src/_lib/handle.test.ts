import assert from 'node:assert/strict';
import test from 'node:test';
import { DriveGatewayError, GoogleDriveGateway, type DriveGateway } from './driveClient.ts';
import { handleDriveRequest, resetPasswordAttempts, type DriveRequest, type DriveResponse } from './handle.ts';
import { passwordsMatch, tokenOk } from './password.ts';

const PASSWORD = 'unit-test-drive-password';
const SENTINEL = 'unit-test-drive-secret-value';

function mockRes() {
  const headers: Record<string, string> = {};
  const res: DriveResponse & { payload: string } = {
    statusCode: 0,
    headersSent: false,
    payload: '',
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
    },
    end(body?: string) {
      res.headersSent = true;
      res.payload = body ?? '';
    },
  };
  return {
    res,
    headers,
    json() {
      return JSON.parse(res.payload) as Record<string, unknown>;
    },
  };
}

function mockReq(method: string, url: string, body?: unknown, cookie = ''): DriveRequest {
  const raw = body == null ? '' : JSON.stringify(body);
  return {
    method,
    url,
    headers: { host: 'command-center.vercel.app', cookie, 'content-type': 'application/json' },
    async *[Symbol.asyncIterator]() {
      if (raw) yield Buffer.from(raw);
    },
  };
}

function saveEnv() {
  return {
    password: process.env.COMMAND_CENTER_PASSWORD,
    id: process.env.GOOGLE_DRIVE_CLIENT_ID,
    secret: process.env.GOOGLE_DRIVE_CLIENT_SECRET,
    token: process.env.GOOGLE_DRIVE_REFRESH_TOKEN,
  };
}

function restoreEnv(saved: ReturnType<typeof saveEnv>) {
  for (const [key, value] of Object.entries({
    COMMAND_CENTER_PASSWORD: saved.password,
    GOOGLE_DRIVE_CLIENT_ID: saved.id,
    GOOGLE_DRIVE_CLIENT_SECRET: saved.secret,
    GOOGLE_DRIVE_REFRESH_TOKEN: saved.token,
  })) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
}

function clearSecrets() {
  delete process.env.COMMAND_CENTER_PASSWORD;
  delete process.env.GOOGLE_DRIVE_CLIENT_ID;
  delete process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  delete process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
}

test('missing and wrong passwords return no Drive files', async () => {
  const saved = saveEnv();
  clearSecrets();
  resetPasswordAttempts();
  const gateway: DriveGateway = {
    async listFiles() {
      throw new Error('should not list');
    },
    async readFile() {
      throw new Error('should not read');
    },
    async createFile() {
      throw new Error('should not create');
    },
    async updateFile() {
      throw new Error('should not update');
    },
  };
  const locked = mockRes();
  await handleDriveRequest(mockReq('GET', '/api/drive/files'), locked.res, { gateway });
  assert.equal(locked.res.statusCode, 503);
  assert.equal(locked.json().needsPassword, true);
  assert.equal('files' in locked.json(), false);
  assert.equal(locked.headers['access-control-allow-origin'], undefined);

  process.env.COMMAND_CENTER_PASSWORD = PASSWORD;
  const wrong = mockRes();
  await handleDriveRequest(mockReq('POST', '/api/drive/session', { password: 'nope' }), wrong.res, { gateway });
  assert.equal(wrong.res.statusCode, 401);
  assert.equal(wrong.json().error, 'Wrong password.');
  assert.equal('files' in wrong.json(), false);
  assert.equal(wrong.headers['set-cookie'], undefined);
  assert.equal(JSON.stringify(wrong.json()).includes(PASSWORD), false);

  const missing = mockRes();
  await handleDriveRequest(mockReq('GET', '/api/drive/files'), missing.res, { gateway });
  assert.equal(missing.res.statusCode, 401);
  assert.equal('files' in missing.json(), false);
  restoreEnv(saved);
});

test('the correct password can list files and a stranger still cannot', async () => {
  const saved = saveEnv();
  resetPasswordAttempts();
  process.env.COMMAND_CENTER_PASSWORD = PASSWORD;
  process.env.GOOGLE_DRIVE_CLIENT_ID = SENTINEL;
  process.env.GOOGLE_DRIVE_CLIENT_SECRET = SENTINEL;
  process.env.GOOGLE_DRIVE_REFRESH_TOKEN = SENTINEL;
  let listed = 0;
  const gateway: DriveGateway = {
    async listFiles() {
      listed += 1;
      return [{ id: 'abcdefghij', name: 'Note', mimeType: 'text/plain', modifiedTime: '', writable: true }];
    },
    async readFile(id: string) {
      return { id, name: 'Note', mimeType: 'text/plain', modifiedTime: '', content: 'hello', writable: true };
    },
    async createFile(name: string, content: string) {
      return { id: 'abcdefghij', name, mimeType: 'text/plain', modifiedTime: '', content, writable: true };
    },
    async updateFile(id: string, content: string) {
      return { id, name: 'Note', mimeType: 'text/plain', modifiedTime: '', content, writable: true };
    },
  };
  const unlocked = mockRes();
  await handleDriveRequest(mockReq('POST', '/api/drive/session', { password: PASSWORD }), unlocked.res, { gateway });
  assert.equal(unlocked.res.statusCode, 200);
  assert.match(unlocked.headers['set-cookie'], /HttpOnly/);
  assert.match(unlocked.headers['set-cookie'], /Secure/);
  const cookie = unlocked.headers['set-cookie'].split(';', 1)[0];
  const list = mockRes();
  await handleDriveRequest(mockReq('GET', '/api/drive/files', undefined, cookie), list.res, { gateway });
  assert.equal(list.res.statusCode, 200);
  assert.equal((list.json().files as unknown[]).length, 1);
  assert.equal(listed, 1);
  assert.equal(JSON.stringify(list.json()).includes(SENTINEL), false);
  assert.equal(JSON.stringify(list.json()).includes(PASSWORD), false);

  delete process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
  const empty = mockRes();
  await handleDriveRequest(mockReq('GET', '/api/drive/files', undefined, cookie), empty.res, { gateway });
  assert.equal(empty.res.statusCode, 503);
  assert.match(String(empty.json().error), /GOOGLE_DRIVE_REFRESH_TOKEN/);
  assert.equal('files' in empty.json(), false);
  assert.equal(empty.json().needsPassword, undefined);
  restoreEnv(saved);
});

test('drive responses scrub a leaked secret', async () => {
  const saved = saveEnv();
  process.env.COMMAND_CENTER_PASSWORD = PASSWORD;
  process.env.GOOGLE_DRIVE_CLIENT_ID = SENTINEL;
  process.env.GOOGLE_DRIVE_CLIENT_SECRET = SENTINEL;
  process.env.GOOGLE_DRIVE_REFRESH_TOKEN = SENTINEL;
  const unlocked = mockRes();
  await handleDriveRequest(mockReq('POST', '/api/drive/session', { password: PASSWORD }), unlocked.res);
  const cookie = unlocked.headers['set-cookie'].split(';', 1)[0];
  const gateway: DriveGateway = {
    async listFiles() {
      throw new DriveGatewayError(`token ${SENTINEL}`);
    },
    async readFile() {
      throw new Error('no');
    },
    async createFile() {
      throw new Error('no');
    },
    async updateFile() {
      throw new Error('no');
    },
  };
  const failed = mockRes();
  await handleDriveRequest(mockReq('GET', '/api/drive/files', undefined, cookie), failed.res, { gateway });
  assert.equal(failed.res.statusCode, 502);
  assert.equal(failed.res.payload.includes(SENTINEL), false);
  assert.match(failed.res.payload, /\[redacted\]/);
  restoreEnv(saved);
});

test('locking a Drive session clears the cookie without a password', async () => {
  const saved = saveEnv();
  resetPasswordAttempts();
  process.env.COMMAND_CENTER_PASSWORD = PASSWORD;
  const unlocked = mockRes();
  await handleDriveRequest(mockReq('POST', '/api/drive/session', { password: PASSWORD }), unlocked.res);
  const cookie = unlocked.headers['set-cookie'].split(';', 1)[0];
  const locked = mockRes();
  await handleDriveRequest(mockReq('POST', '/api/drive/session', { lock: true }, cookie), locked.res);
  assert.equal(locked.res.statusCode, 200);
  assert.equal(locked.json().ok, true);
  assert.match(locked.headers['set-cookie'], /Max-Age=0/);
  assert.equal('files' in locked.json(), false);
  restoreEnv(saved);
});

test('password compare and session token reject a mismatch', () => {
  process.env.COMMAND_CENTER_PASSWORD = PASSWORD;
  assert.equal(passwordsMatch(PASSWORD), true);
  assert.equal(passwordsMatch('nope'), false);
  assert.equal(passwordsMatch(''), false);
  const issuedAt = 1_700_000_000_000;
  const token = tokenOk('1.not-a-real-signature', issuedAt);
  assert.equal(token, false);
  delete process.env.COMMAND_CENTER_PASSWORD;
});

test('a mismatched Google account does not return files', async () => {
  const saved = saveEnv();
  process.env.GOOGLE_DRIVE_CLIENT_ID = SENTINEL;
  process.env.GOOGLE_DRIVE_CLIENT_SECRET = SENTINEL;
  process.env.GOOGLE_DRIVE_REFRESH_TOKEN = SENTINEL;
  const urls: string[] = [];
  const gateway = new GoogleDriveGateway(async (_method, url) => {
    urls.push(url);
    if (url.includes('oauth2.googleapis.com')) return { status: 200, body: new TextEncoder().encode('{"access_token":"ya29.test"}') };
    if (url.includes('about?fields=')) {
      return { status: 200, body: new TextEncoder().encode('{"user":{"emailAddress":"someoneelse@gmail.com"}}') };
    }
    return { status: 500, body: new TextEncoder().encode('{"error":"should not list"}') };
  });
  await assert.rejects(() => gateway.listFiles(), /caseylsims@gmail.com/);
  assert.equal(urls.some((url) => url.includes('/drive/v3/files')), false);
  restoreEnv(saved);
});
