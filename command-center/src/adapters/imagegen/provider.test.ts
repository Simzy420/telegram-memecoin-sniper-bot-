import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeStillImageProvider, stillAdapterKind } from './provider.ts';

test('missing or unknown provider defaults to Pollinations', () => {
  assert.equal(normalizeStillImageProvider(undefined), 'pollinations');
  assert.equal(normalizeStillImageProvider(null), 'pollinations');
  assert.equal(normalizeStillImageProvider(''), 'pollinations');
  assert.equal(normalizeStillImageProvider('dall-e'), 'pollinations');
  assert.equal(normalizeStillImageProvider('openai'), 'openai');
});

test('Pollinations ignores the proxy', () => {
  assert.equal(stillAdapterKind('pollinations', true), 'pollinations');
  assert.equal(stillAdapterKind('pollinations', false), 'pollinations');
});

test('OpenAI uses the proxy when this host has one, otherwise the pasted key', () => {
  assert.equal(stillAdapterKind('openai', true), 'openai-proxy');
  assert.equal(stillAdapterKind('openai', false), 'openai-vault');
});
