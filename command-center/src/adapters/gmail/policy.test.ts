import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  GMAIL_INBOX_LIMIT,
  GMAIL_MAILBOX,
  GMAIL_TITLE_FONT,
  capInbox,
  isPublicMailHost,
  mailRequestsAllowed,
  normalizeSummary,
} from './policy.ts';

test('mail calls are refused on the public site and the chat Space', () => {
  for (const host of [
    'simzy420.github.io',
    'github.io',
    'simzy-command-center-chat.hf.space',
    'huggingface.co',
    'command-center.vercel.app',
    'preview.netlify.app',
    'command.pages.dev',
    '',
  ]) {
    assert.equal(mailRequestsAllowed(host), false, host);
    assert.equal(isPublicMailHost(host), true, host);
  }
  assert.equal(mailRequestsAllowed('localhost'), true);
  assert.equal(mailRequestsAllowed('127.0.0.1'), true);
  assert.equal(mailRequestsAllowed('192.168.1.20:5173'), true);
  assert.equal(mailRequestsAllowed('[::1]'), true);
});

test('the Gmail label uses a serif stack and not the body font', () => {
  assert.match(GMAIL_TITLE_FONT, /Fraunces/);
  assert.match(GMAIL_TITLE_FONT, /serif/);
  assert.equal(GMAIL_TITLE_FONT.includes('Sora'), false);
  assert.equal(GMAIL_TITLE_FONT.includes('Orbitron'), false);
});

test('inbox rows are capped at the newest 25 and ignore bad ids', () => {
  const rows = Array.from({ length: 40 }, (_, index) => ({
    uid: String(index + 1),
    from: 'A <a@b.co>',
    subject: 'Hi',
    date: '2026-10-01T00:00:00Z',
  }));
  assert.equal(capInbox(rows).length, GMAIL_INBOX_LIMIT);
  assert.equal(normalizeSummary({ uid: '12', from: 'Ada', subject: 'Hi', date: '' })?.uid, '12');
  assert.equal(normalizeSummary({ uid: '../etc/passwd' }), null);
  assert.equal(GMAIL_MAILBOX, 'caseylsims@gmail.com');
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

test('the phone sources never read the mail secret', () => {
  const files = walk('src').filter((file) => /\.(ts|tsx|js|css)$/.test(file) && !file.endsWith('.test.ts'));
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    assert.equal(/import\.meta\.env\.(VITE_)?GMAIL/i.test(text), false, file);
    assert.equal(/process\.env\.GMAIL_APP_PASSWORD/.test(text), false, file);
    assert.equal(text.includes('VITE_GMAIL_APP_PASSWORD'), false, file);
  }
});

test('Gmail is a normal registry widget and the public Space has no mail route', () => {
  const registry = readFileSync('src/registry/index.ts', 'utf8');
  assert.match(registry, /type: 'gmail'/);
  assert.match(registry, /title: 'Gmail'/);
  assert.equal(registry.includes("featureFlag: 'gmailStub'"), false);
  const space = readFileSync('spaces/command-center-chat/main.py', 'utf8');
  assert.equal(space.includes('/api/gmail'), false);
  assert.equal(space.includes('GMAIL_APP_PASSWORD'), false);
  const apiNames = readdirSync('api');
  assert.equal(apiNames.some((name) => name.toLowerCase().includes('gmail')), false);
});
