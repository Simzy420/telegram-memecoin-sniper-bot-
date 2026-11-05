import { AI_TOOL_LINKS } from '@/components/shell/aiToolsData';
import { uid } from '@/lib/ids';
import { readJson, writeJson } from '@/store/persist';

export const AGENT_RELAY_STORAGE_KEY = 'agentRelay';

export type RelayAgentSource = 'builtin' | 'custom';

export interface RelayAgent {
  id: string;
  name: string;
  url: string;
  source: RelayAgentSource;
  addedAt: number;
  lastUsedAt: number | null;
}

export interface RelaySwitchEvent {
  id: string;
  at: number;
  fromAgentId: string | null;
  toAgentId: string;
  note: string;
}

export interface RelayProject {
  id: string;
  name: string;
  goal: string;
  /** Living brief the next agent should read. */
  handoff: string;
  agents: RelayAgent[];
  activeAgentId: string | null;
  switches: RelaySwitchEvent[];
  createdAt: number;
  updatedAt: number;
}

export interface AgentRelaySnapshot {
  version: 1;
  projects: RelayProject[];
  activeProjectId: string | null;
  updatedAt: number;
}

const emptySnapshot = (): AgentRelaySnapshot => ({
  version: 1,
  projects: [],
  activeProjectId: null,
  updatedAt: 0,
});

export function normalizeUrl(raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  if (/^https?:\/\//i.test(t)) return t;
  return `https://${t}`;
}

export function builtinAgentsFromMenu(now = Date.now()): RelayAgent[] {
  return AI_TOOL_LINKS.map((tool) => ({
    id: uid('agent'),
    name: tool.name,
    url: tool.href,
    source: 'builtin' as const,
    addedAt: now,
    lastUsedAt: null,
  }));
}

export function defaultHandoff(name: string, goal: string): string {
  const goalLine = goal.trim() || '(add the goal for this build)';
  return [
    `# Agent Relay — ${name.trim() || 'Untitled project'}`,
    '',
    '## Goal',
    goalLine,
    '',
    '## Where we are',
    '- Started a new project in Dark Command Center Agent Relay.',
    '- No build steps recorded yet.',
    '',
    '## Done',
    '- (nothing yet)',
    '',
    '## Next',
    '- Pick the first concrete step with the active agent.',
    '',
    '## Constraints',
    '- Keep going from this brief when the user switches agents or tools.',
    '- Do not ask the user to re-explain the whole project; read this first.',
    '',
    '## Links / files',
    '- (add repo, preview URL, or file names here)',
  ].join('\n');
}

export function formatHandoffPaste(project: RelayProject, agent: RelayAgent | null): string {
  const active = agent?.name ?? 'none';
  const stamp = new Date(project.updatedAt || Date.now()).toISOString();
  return [
    project.handoff.trim(),
    '',
    '---',
    `Active agent/tool: ${active}`,
    `Project: ${project.name}`,
    `Brief updated: ${stamp}`,
    'Source: Dark Command Center · Agent Relay',
    'Instruction: Continue this project from the brief above. Do not restart from scratch.',
  ].join('\n');
}

export function readRelaySnapshot(): AgentRelaySnapshot {
  const raw = readJson<AgentRelaySnapshot | null>(AGENT_RELAY_STORAGE_KEY, null);
  if (!raw || raw.version !== 1 || !Array.isArray(raw.projects)) return emptySnapshot();
  return raw;
}

export function writeRelaySnapshot(snapshot: AgentRelaySnapshot): void {
  writeJson(AGENT_RELAY_STORAGE_KEY, { ...snapshot, updatedAt: Date.now() });
}

export function createProject(name: string, goal = '', now = Date.now()): RelayProject {
  const trimmed = name.trim() || 'Untitled project';
  const agents = builtinAgentsFromMenu(now);
  return {
    id: uid('proj'),
    name: trimmed,
    goal: goal.trim(),
    handoff: defaultHandoff(trimmed, goal),
    agents,
    activeAgentId: agents[0]?.id ?? null,
    switches: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function findAgent(project: RelayProject, agentId: string | null): RelayAgent | null {
  if (!agentId) return null;
  return project.agents.find((a) => a.id === agentId) ?? null;
}

export function upsertAgentByUrl(
  project: RelayProject,
  name: string,
  url: string,
  source: RelayAgentSource,
  now = Date.now(),
): { project: RelayProject; agent: RelayAgent; created: boolean } {
  const href = normalizeUrl(url);
  if (!href) throw new Error('Enter a URL.');
  const label = name.trim() || new URL(href).hostname;
  const existing = project.agents.find((a) => a.url === href);
  if (existing) {
    return { project, agent: existing, created: false };
  }
  const agent: RelayAgent = {
    id: uid('agent'),
    name: label,
    url: href,
    source,
    addedAt: now,
    lastUsedAt: null,
  };
  return {
    project: {
      ...project,
      agents: [...project.agents, agent],
      updatedAt: now,
    },
    agent,
    created: true,
  };
}

export function switchToAgent(
  project: RelayProject,
  agentId: string,
  note = '',
  now = Date.now(),
): RelayProject {
  const next = project.agents.find((a) => a.id === agentId);
  if (!next) throw new Error('That agent is not on this project.');
  if (project.activeAgentId === agentId) {
    return {
      ...project,
      agents: project.agents.map((a) => (a.id === agentId ? { ...a, lastUsedAt: now } : a)),
      updatedAt: now,
    };
  }
  const event: RelaySwitchEvent = {
    id: uid('sw'),
    at: now,
    fromAgentId: project.activeAgentId,
    toAgentId: agentId,
    note: note.trim() || `Switched to ${next.name}`,
  };
  const handoff = appendSwitchNote(project.handoff, event, project.agents, next);
  return {
    ...project,
    activeAgentId: agentId,
    agents: project.agents.map((a) => (a.id === agentId ? { ...a, lastUsedAt: now } : a)),
    switches: [event, ...project.switches].slice(0, 40),
    handoff,
    updatedAt: now,
  };
}

function appendSwitchNote(
  handoff: string,
  event: RelaySwitchEvent,
  agents: RelayAgent[],
  next: RelayAgent,
): string {
  const from = agents.find((a) => a.id === event.fromAgentId)?.name ?? 'none';
  const line = `- ${new Date(event.at).toISOString()}: ${from} → ${next.name}${event.note ? ` — ${event.note}` : ''}`;
  if (/## Switch log/i.test(handoff)) {
    return handoff.replace(/## Switch log\n(?:- .+\n)*/i, (block) => {
      const header = block.split('\n')[0];
      const rest = block
        .split('\n')
        .slice(1)
        .filter((row) => row.startsWith('- '))
        .slice(0, 19);
      return `${header}\n${line}\n${rest.join('\n')}${rest.length ? '\n' : ''}`;
    });
  }
  return `${handoff.trim()}\n\n## Switch log\n${line}\n`;
}
