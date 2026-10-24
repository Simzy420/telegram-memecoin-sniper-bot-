import { create } from 'zustand';
import {
  createProject,
  findAgent,
  formatHandoffPaste,
  normalizeUrl,
  readRelaySnapshot,
  switchToAgent,
  upsertAgentByUrl,
  writeRelaySnapshot,
  type RelayAgent,
  type RelayProject,
} from '@/store/agentRelay';

interface AgentRelayState {
  projects: RelayProject[];
  activeProjectId: string | null;
  notice: string;
  lastCopiedAt: number | null;
  createProject: (name: string, goal?: string) => string;
  setActiveProject: (projectId: string) => void;
  renameProject: (projectId: string, name: string) => void;
  setGoal: (projectId: string, goal: string) => void;
  setHandoff: (projectId: string, handoff: string) => void;
  addCustomAgent: (projectId: string, name: string, url: string) => RelayAgent;
  removeAgent: (projectId: string, agentId: string) => void;
  /** Switch active agent, refresh handoff log, and return paste text for the next bot. */
  activateAgent: (projectId: string, agentId: string, note?: string) => { agent: RelayAgent; paste: string };
  /** Ensure a menu tool exists on the active project, activate it, return paste + url. */
  openMenuTool: (name: string, url: string) => { agent: RelayAgent; paste: string; project: RelayProject } | null;
  clearNotice: () => void;
  setNotice: (msg: string) => void;
  markCopied: () => void;
}

function persist(projects: RelayProject[], activeProjectId: string | null) {
  writeRelaySnapshot({ version: 1, projects, activeProjectId, updatedAt: Date.now() });
}

function replaceProject(projects: RelayProject[], next: RelayProject): RelayProject[] {
  return projects.map((p) => (p.id === next.id ? next : p));
}

const boot = readRelaySnapshot();

export const useAgentRelayStore = create<AgentRelayState>((set, get) => ({
  projects: boot.projects,
  activeProjectId: boot.activeProjectId,
  notice: '',
  lastCopiedAt: null,

  createProject: (name, goal = '') => {
    const project = createProject(name, goal);
    const projects = [project, ...get().projects];
    set({ projects, activeProjectId: project.id, notice: 'Project ready.' });
    persist(projects, project.id);
    return project.id;
  },

  setActiveProject: (projectId) => {
    if (!get().projects.some((p) => p.id === projectId)) return;
    set({ activeProjectId: projectId });
    persist(get().projects, projectId);
  },

  renameProject: (projectId, name) => {
    const current = get().projects.find((p) => p.id === projectId);
    if (!current) return;
    const next = { ...current, name: name.trim() || current.name, updatedAt: Date.now() };
    const projects = replaceProject(get().projects, next);
    set({ projects });
    persist(projects, get().activeProjectId);
  },

  setGoal: (projectId, goal) => {
    const current = get().projects.find((p) => p.id === projectId);
    if (!current) return;
    const next = { ...current, goal: goal.trim(), updatedAt: Date.now() };
    const projects = replaceProject(get().projects, next);
    set({ projects });
    persist(projects, get().activeProjectId);
  },

  setHandoff: (projectId, handoff) => {
    const current = get().projects.find((p) => p.id === projectId);
    if (!current) return;
    const next = { ...current, handoff, updatedAt: Date.now() };
    const projects = replaceProject(get().projects, next);
    set({ projects });
    persist(projects, get().activeProjectId);
  },

  addCustomAgent: (projectId, name, url) => {
    const current = get().projects.find((p) => p.id === projectId);
    if (!current) throw new Error('Create a project first.');
    const { project, agent } = upsertAgentByUrl(current, name, url, 'custom');
    const projects = replaceProject(get().projects, project);
    set({ projects, notice: `${agent.name} added.` });
    persist(projects, get().activeProjectId);
    return agent;
  },

  removeAgent: (projectId, agentId) => {
    const current = get().projects.find((p) => p.id === projectId);
    if (!current) return;
    if (current.agents.length <= 1) {
      set({ notice: 'Keep at least one agent on the project.' });
      return;
    }
    const agents = current.agents.filter((a) => a.id !== agentId);
    const activeAgentId =
      current.activeAgentId === agentId ? (agents[0]?.id ?? null) : current.activeAgentId;
    const next = { ...current, agents, activeAgentId, updatedAt: Date.now() };
    const projects = replaceProject(get().projects, next);
    set({ projects });
    persist(projects, get().activeProjectId);
  },

  activateAgent: (projectId, agentId, note) => {
    const current = get().projects.find((p) => p.id === projectId);
    if (!current) throw new Error('Create a project first.');
    const next = switchToAgent(current, agentId, note);
    const agent = findAgent(next, agentId);
    if (!agent) throw new Error('That agent is not on this project.');
    const projects = replaceProject(get().projects, next);
    set({
      projects,
      notice: `Switched to ${agent.name}. Handoff ready to paste.`,
    });
    persist(projects, get().activeProjectId);
    return { agent, paste: formatHandoffPaste(next, agent) };
  },

  openMenuTool: (name, url) => {
    let projectId = get().activeProjectId;
    let projects = get().projects;
    if (!projectId || !projects.some((p) => p.id === projectId)) {
      const project = createProject('Phone build', 'Build with AI agents from Dark Command Center.');
      projects = [project, ...projects];
      projectId = project.id;
      set({ projects, activeProjectId: projectId });
      persist(projects, projectId);
    }
    const current = projects.find((p) => p.id === projectId);
    if (!current) return null;
    const href = normalizeUrl(url);
    const upserted = upsertAgentByUrl(current, name, href, 'builtin');
    const switched = switchToAgent(upserted.project, upserted.agent.id, `Opened ${name} from AI Tools`);
    const agent = findAgent(switched, upserted.agent.id);
    if (!agent) return null;
    const nextProjects = replaceProject(projects, switched);
    set({
      projects: nextProjects,
      activeProjectId: projectId,
      notice: `${agent.name} is active. Handoff copied when you open it.`,
    });
    persist(nextProjects, projectId);
    return { agent, paste: formatHandoffPaste(switched, agent), project: switched };
  },

  clearNotice: () => set({ notice: '' }),
  setNotice: (msg) => set({ notice: msg }),
  markCopied: () => set({ lastCopiedAt: Date.now() }),
}));

export function activeRelayProject(): RelayProject | null {
  const { projects, activeProjectId } = useAgentRelayStore.getState();
  return projects.find((p) => p.id === activeProjectId) ?? null;
}
