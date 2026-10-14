import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const tools = readFileSync('src/components/shell/aiTools.tsx', 'utf8');
const drawer = readFileSync('src/components/shell/SideDrawer.tsx', 'utf8');

test('AI Tools lists only the circled apps and opens each in a new tab', () => {
  assert.match(drawer, /AiToolsMenuButton/);
  assert.match(drawer, /AiToolsPanel/);
  assert.match(tools, /AI_TOOLS_LABEL = 'AI Tools'/);
  for (const href of [
    'https://chatgpt.com',
    'https://base44.com',
    'https://cursor.com',
    'https://buffer.com',
    'https://linear.app',
    'https://replit.com',
    'https://www.perplexity.ai',
    'https://apps.apple.com/app/id1623228342',
  ]) {
    assert.equal(tools.includes(href), true, href);
  }
  for (const name of ['ChatGPT', 'Base44', 'Cursor', 'Buffer', 'Linear', 'Replit', 'Perplexity', 'Link']) {
    assert.match(tools, new RegExp(`name: '${name}'`));
  }
  assert.match(tools, /target="_blank"/);
  assert.match(tools, /rel="noopener noreferrer"/);
  for (const banned of [
    'Grok Bot',
    'Claude',
    'OpenAI Platform',
    'Kimi',
    'Kling',
    'Suno',
    'AI Video',
    'Alinea',
    'Evernote',
    'Createepic',
  ]) {
    assert.equal(tools.includes(banned), false, banned);
    assert.equal(drawer.includes(banned), false, banned);
  }
});
