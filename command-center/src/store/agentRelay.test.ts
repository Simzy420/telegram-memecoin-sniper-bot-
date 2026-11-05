import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createProject,
  formatHandoffPaste,
  normalizeUrl,
  switchToAgent,
  upsertAgentByUrl,
} from '@/store/agentRelay';

test('normalizeUrl adds https when missing', () => {
  assert.equal(normalizeUrl('chatgpt.com'), 'https://chatgpt.com');
  assert.equal(normalizeUrl('https://replit.com'), 'https://replit.com');
});

test('new projects seed AI Tools menu agents and a handoff brief', () => {
  const project = createProject('Landing page', 'Ship a phone-first site', 1_700_000_000_000);
  assert.equal(project.name, 'Landing page');
  assert.ok(project.agents.some((a) => a.name === 'ChatGPT'));
  assert.ok(project.agents.some((a) => a.name === 'Cursor'));
  assert.ok(project.agents.some((a) => a.name === 'Replit'));
  assert.match(project.handoff, /Agent Relay/);
  assert.match(project.handoff, /Ship a phone-first site/);
  assert.ok(project.activeAgentId);
});

test('switching agents appends a switch log and keeps the brief pasteable', () => {
  const project = createProject('App', 'Build an app', 1_700_000_000_000);
  const cursor = project.agents.find((a) => a.name === 'Cursor');
  assert.ok(cursor);
  const next = switchToAgent(project, cursor.id, 'Credits empty on first tool', 1_700_000_000_100);
  assert.equal(next.activeAgentId, cursor.id);
  assert.match(next.handoff, /## Switch log/);
  assert.match(next.handoff, /Cursor/);
  const paste = formatHandoffPaste(next, cursor);
  assert.match(paste, /Continue this project from the brief above/);
  assert.match(paste, /Active agent\/tool: Cursor/);
});

test('custom URLs can be added without duplicating the same href', () => {
  const project = createProject('Mix', '', 1_700_000_000_000);
  const first = upsertAgentByUrl(project, 'Claude', 'claude.ai', 'custom', 1_700_000_000_200);
  assert.equal(first.created, true);
  assert.equal(first.agent.url, 'https://claude.ai');
  const second = upsertAgentByUrl(first.project, 'Claude again', 'https://claude.ai', 'custom', 1_700_000_000_300);
  assert.equal(second.created, false);
  assert.equal(second.project.agents.filter((a) => a.url === 'https://claude.ai').length, 1);
});
