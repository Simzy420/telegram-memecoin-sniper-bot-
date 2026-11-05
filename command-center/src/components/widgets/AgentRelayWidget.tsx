import { useMemo, useState } from 'react';
import { Copy, ExternalLink, Plus, Share2, Trash2, Zap } from 'lucide-react';
import { copyText, openToolWithHandoff, shareHandoff } from '@/adapters/agentRelay/openTool';
import { WidgetFrame } from '@/components/shell/WidgetFrame';
import { cn } from '@/lib/cn';
import { findAgent, formatHandoffPaste } from '@/store/agentRelay';
import { useAgentRelayStore } from '@/store/agentRelayStore';
import type { WidgetRenderProps } from '@/registry/types';

export function AgentRelayWidget({ widget }: WidgetRenderProps) {
  const projects = useAgentRelayStore((s) => s.projects);
  const activeProjectId = useAgentRelayStore((s) => s.activeProjectId);
  const notice = useAgentRelayStore((s) => s.notice);
  const createProject = useAgentRelayStore((s) => s.createProject);
  const setActiveProject = useAgentRelayStore((s) => s.setActiveProject);
  const setGoal = useAgentRelayStore((s) => s.setGoal);
  const setHandoff = useAgentRelayStore((s) => s.setHandoff);
  const addCustomAgent = useAgentRelayStore((s) => s.addCustomAgent);
  const removeAgent = useAgentRelayStore((s) => s.removeAgent);
  const activateAgent = useAgentRelayStore((s) => s.activateAgent);
  const markCopied = useAgentRelayStore((s) => s.markCopied);
  const setNotice = useAgentRelayStore((s) => s.setNotice);

  const [newName, setNewName] = useState('');
  const [newGoal, setNewGoal] = useState('');
  const [agentName, setAgentName] = useState('');
  const [agentUrl, setAgentUrl] = useState('');
  const [showAddAgent, setShowAddAgent] = useState(false);
  const [busy, setBusy] = useState(false);

  const project = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? projects[0] ?? null,
    [projects, activeProjectId],
  );
  const active = project ? findAgent(project, project.activeAgentId) : null;

  async function runOpen(agentId: string) {
    if (!project) return;
    setBusy(true);
    try {
      const { agent, paste } = activateAgent(project.id, agentId);
      const result = await openToolWithHandoff({
        url: agent.url,
        paste,
        title: `${project.name} · ${agent.name}`,
      });
      if (result.copied) markCopied();
      setNotice(
        result.copied
          ? `${agent.name} opened. Handoff is on your clipboard — paste it into the chat.`
          : `${agent.name} opened. Copy the handoff below, then paste it into the chat.`,
      );
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not open that agent.');
    } finally {
      setBusy(false);
    }
  }

  async function onCopy() {
    if (!project) return;
    const paste = formatHandoffPaste(project, active);
    const ok = await copyText(paste);
    if (ok) {
      markCopied();
      setNotice('Handoff copied. Paste it into the next agent.');
    } else {
      setNotice('Could not copy. Select the brief and copy manually.');
    }
  }

  async function onShare() {
    if (!project) return;
    const paste = formatHandoffPaste(project, active);
    const ok = await shareHandoff({ title: project.name, paste });
    setNotice(ok ? 'Shared the handoff.' : 'Share sheet unavailable — use Copy instead.');
  }

  return (
    <WidgetFrame
      widget={widget}
      title="Agent Relay"
      badge="RELAY"
      footer={
        <p className="text-[11px] leading-snug text-white/45">
          Switch tools when free credits run out. The handoff brief travels with you so the next agent
          already knows the project.
        </p>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain pb-1">
        {notice ? (
          <p className="rounded-xl border border-cyan-300/30 bg-cyan-400/10 px-3 py-2 text-xs text-cyan-50" role="status">
            {notice}
          </p>
        ) : null}

        {!project ? (
          <form
            className="space-y-2 rounded-2xl border border-white/10 bg-black/25 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              createProject(newName || 'Phone build', newGoal);
              setNewName('');
              setNewGoal('');
            }}
          >
            <p className="text-[10px] uppercase tracking-[0.18em] text-white/45">New project</p>
            <input
              className="hud-input w-full"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Project name"
              autoComplete="off"
            />
            <textarea
              className="hud-input min-h-[88px] w-full resize-y"
              value={newGoal}
              onChange={(e) => setNewGoal(e.target.value)}
              placeholder="What are you building?"
            />
            <button type="submit" className="hud-btn-primary w-full">
              Start project
            </button>
          </form>
        ) : (
          <>
            <div className="space-y-2">
              <label className="block text-[10px] uppercase tracking-[0.18em] text-white/45">Project</label>
              <select
                className="hud-input w-full"
                value={project.id}
                onChange={(e) => setActiveProject(e.target.value)}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="hud-btn-ghost w-full"
                onClick={() => {
                  const name = window.prompt('New project name', 'Phone build');
                  if (!name) return;
                  createProject(name);
                }}
              >
                <Plus className="h-4 w-4" /> Another project
              </button>
            </div>

            <div className="space-y-2">
              <label className="block text-[10px] uppercase tracking-[0.18em] text-white/45">Goal</label>
              <textarea
                className="hud-input min-h-[72px] w-full resize-y"
                value={project.goal}
                onChange={(e) => setGoal(project.id, e.target.value)}
                placeholder="One sentence for every agent that joins later"
              />
            </div>

            <div className="rounded-2xl border border-cyan-300/25 bg-cyan-400/10 p-3">
              <p className="text-[10px] uppercase tracking-[0.18em] text-cyan-100/80">Active now</p>
              <p className="mt-1 text-base font-semibold text-white">{active?.name ?? 'Pick an agent'}</p>
              <button
                type="button"
                className="hud-btn-primary mt-3 w-full gap-2"
                disabled={!active || busy}
                onClick={() => active && void runOpen(active.id)}
              >
                <Zap className="h-4 w-4" />
                Open with handoff
              </button>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] uppercase tracking-[0.18em] text-white/45">Agents & tools</p>
                <button
                  type="button"
                  className="hud-chip"
                  onClick={() => setShowAddAgent((v) => !v)}
                >
                  <Plus className="h-3.5 w-3.5" /> Add URL
                </button>
              </div>

              {showAddAgent ? (
                <form
                  className="space-y-2 rounded-2xl border border-dashed border-white/15 p-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    try {
                      const agent = addCustomAgent(project.id, agentName, agentUrl);
                      setAgentName('');
                      setAgentUrl('');
                      setShowAddAgent(false);
                      void runOpen(agent.id);
                    } catch (err) {
                      setNotice(err instanceof Error ? err.message : 'Could not add that URL.');
                    }
                  }}
                >
                  <input
                    className="hud-input w-full"
                    value={agentName}
                    onChange={(e) => setAgentName(e.target.value)}
                    placeholder="Name (optional)"
                  />
                  <input
                    className="hud-input w-full"
                    value={agentUrl}
                    onChange={(e) => setAgentUrl(e.target.value)}
                    placeholder="https://…"
                    inputMode="url"
                    autoCapitalize="off"
                    autoCorrect="off"
                    required
                  />
                  <button type="submit" className="hud-btn-primary w-full" disabled={busy}>
                    Add & open
                  </button>
                </form>
              ) : null}

              <ul className="flex flex-col gap-2">
                {project.agents.map((agent) => {
                  const on = agent.id === project.activeAgentId;
                  return (
                    <li key={agent.id}>
                      <div
                        className={cn(
                          'flex items-stretch gap-2 rounded-2xl border px-2 py-2',
                          on ? 'border-cyan-300/50 bg-cyan-400/10' : 'border-white/10 bg-white/5',
                        )}
                      >
                        <button
                          type="button"
                          className="min-h-[48px] flex-1 rounded-xl px-2 text-left"
                          disabled={busy}
                          onClick={() => void runOpen(agent.id)}
                        >
                          <span className="block text-sm font-medium text-white">{agent.name}</span>
                          <span className="mt-0.5 block truncate text-[11px] text-white/40">{agent.url}</span>
                        </button>
                        <a
                          href={agent.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex min-h-[48px] min-w-[44px] items-center justify-center rounded-xl border border-white/10 text-white/70"
                          aria-label={`Open ${agent.name} without switching`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                        {agent.source === 'custom' ? (
                          <button
                            type="button"
                            className="inline-flex min-h-[48px] min-w-[44px] items-center justify-center rounded-xl border border-white/10 text-rose-200/80"
                            aria-label={`Remove ${agent.name}`}
                            onClick={() => removeAgent(project.id, agent.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] uppercase tracking-[0.18em] text-white/45">Handoff brief</p>
                <div className="flex gap-1">
                  <button type="button" className="hud-chip" onClick={() => void onCopy()}>
                    <Copy className="h-3.5 w-3.5" /> Copy
                  </button>
                  <button type="button" className="hud-chip" onClick={() => void onShare()}>
                    <Share2 className="h-3.5 w-3.5" /> Share
                  </button>
                </div>
              </div>
              <textarea
                className="hud-input min-h-[180px] w-full resize-y font-mono text-[12px] leading-relaxed"
                value={project.handoff}
                onChange={(e) => setHandoff(project.id, e.target.value)}
                spellCheck={false}
              />
              <p className="text-[11px] leading-snug text-white/40">
                Edit this as you build. When you switch agents, Agent Relay copies it so the next bot can
                pick up cold.
              </p>
            </div>

            {project.switches.length ? (
              <div className="space-y-2">
                <p className="text-[10px] uppercase tracking-[0.18em] text-white/45">Switch log</p>
                <ul className="space-y-1.5">
                  {project.switches.slice(0, 8).map((row) => {
                    const to = project.agents.find((a) => a.id === row.toAgentId)?.name ?? 'agent';
                    return (
                      <li key={row.id} className="rounded-xl border border-white/10 px-3 py-2 text-xs text-white/65">
                        <span className="text-white/40">{new Date(row.at).toLocaleString()}</span>
                        <span className="mt-0.5 block text-white/80">→ {to}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
          </>
        )}
      </div>
    </WidgetFrame>
  );
}
