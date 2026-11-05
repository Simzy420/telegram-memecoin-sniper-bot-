import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  DRIVE_ACCOUNT,
  DRIVE_LIST_LIMIT,
  DRIVE_SCOPE,
  DRIVE_TITLE_STYLE,
  PUBLIC_CLOSED_MESSAGE,
  capDriveFiles,
  driveRequestsAllowed,
  normalizeDriveFile,
} from './policy.ts';

test('Drive calls are refused on static hosts and allowed on the Vercel phone site', () => {
  for (const host of [
    'simzy420.github.io',
    'github.io',
    'simzy-command-center-chat.hf.space',
    'huggingface.co',
    'preview.netlify.app',
    'command.pages.dev',
    '',
  ]) {
    assert.equal(driveRequestsAllowed(host), false, host);
  }
  assert.equal(driveRequestsAllowed('command-center.vercel.app'), true);
  assert.equal(driveRequestsAllowed('localhost'), true);
  assert.equal(driveRequestsAllowed('127.0.0.1'), true);
  assert.equal(driveRequestsAllowed('192.168.1.20:5173'), true);
  assert.equal(driveRequestsAllowed('[::1]'), true);
});

test('the Google Drive label keeps its words and the account is locked', () => {
  assert.equal(DRIVE_TITLE_STYLE.textTransform, 'none');
  assert.match(DRIVE_TITLE_STYLE.fontFamily, /Orbitron/);
  assert.equal(DRIVE_ACCOUNT, 'caseylsims@gmail.com');
  assert.match(DRIVE_SCOPE, /auth\/drive$/);
  assert.match(PUBLIC_CLOSED_MESSAGE, /GitHub Pages/);
  assert.match(PUBLIC_CLOSED_MESSAGE, /Vercel site/);
});

test('file rows are capped at 25 and ignore bad ids', () => {
  const rows = Array.from({ length: 40 }, (_, index) => ({
    id: `fileid${String(index).padStart(4, '0')}`,
    name: `n${index}`,
    mimeType: 'text/plain',
    modifiedTime: '',
    writable: true,
  }));
  assert.equal(capDriveFiles(rows).length, DRIVE_LIST_LIMIT);
  assert.equal(normalizeDriveFile({ id: 'abcdefgh', name: 'A' })?.id, 'abcdefgh');
  assert.equal(normalizeDriveFile({ id: '../etc/passwd', name: 'A' }), null);
  assert.equal(normalizeDriveFile({ id: 'short', name: 'A' }), null);
});

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}

test('the phone sources never read a Google Drive secret', () => {
  const files = walk('src').filter((file) => /\.(ts|tsx|js|css)$/.test(file) && !file.endsWith('.test.ts'));
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    assert.equal(/import\.meta\.env\.(VITE_)?GOOGLE/i.test(text), false, file);
    assert.equal(/process\.env\.GOOGLE_DRIVE/.test(text), false, file);
    assert.equal(/process\.env\.COMMAND_CENTER_PASSWORD/.test(text), false, file);
    assert.equal(/VITE_GOOGLE/.test(text), false, file);
    assert.equal(/VITE_COMMAND_CENTER/.test(text), false, file);
  }
});

test('Google Drive is a normal widget and Files still saves on this device', () => {
  const registry = readFileSync('src/registry/index.ts', 'utf8');
  assert.match(registry, /type: 'drive'/);
  assert.match(registry, /title: 'Google Drive'/);
  assert.match(registry, /type: 'files'/);
  assert.equal(/featureFlag: 'drive'/.test(registry), false);
  const widget = readFileSync('src/components/widgets/DriveWidget.tsx', 'utf8');
  assert.match(widget, /title="Google Drive"/);
  assert.match(widget, /handOffFile/);
  assert.match(widget, /driveRequestsAllowed/);
  assert.match(widget, /type="password"/);
  const app = readFileSync('src/App.tsx', 'utf8');
  assert.equal(app.includes('type="password"'), false);
  const handle = readFileSync('api/_lib/password.ts', 'utf8');
  assert.match(handle, /COMMAND_CENTER_PASSWORD/);
  assert.equal(/COMMAND_CENTER_PASSWORD\s*=\s*['"]/.test(handle), false);
  const client = readFileSync('src/adapters/drive/client.ts', 'utf8');
  assert.match(client, /assertPrivateDriveHost/);
  assert.match(client, /\/api\/drive\/files/);
  const files = readFileSync('src/components/widgets/FilesWidget.tsx', 'utf8');
  assert.match(files, /Saved on this device\. Nothing was uploaded\./);
  assert.match(files, /handOffFile/);
  assert.match(files, /Open downloads/);
  assert.match(files, /openDeviceDownloads/);
  assert.match(files, /Open File/);
  assert.match(files, /readLocalTextFiles/);
  const space = readFileSync('spaces/command-center-chat/main.py', 'utf8');
  assert.equal(space.includes('/api/drive'), false);
  assert.equal(space.includes('GOOGLE_DRIVE_CLIENT_SECRET'), false);
  assert.equal(space.includes('COMMAND_CENTER_PASSWORD'), false);
});
