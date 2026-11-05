import { useEffect, useState, type FormEvent } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  createDriveFile,
  DriveClosedError,
  DriveNeedsPasswordError,
  DriveUnreachableError,
  loadDriveFile,
  loadDriveFiles,
  loadDriveSession,
  unlockDrive,
  updateDriveFile,
} from '@/adapters/drive/client';
import {
  DRIVE_ACCOUNT,
  DRIVE_TITLE_STYLE,
  PUBLIC_CLOSED_MESSAGE,
  driveRequestsAllowed,
  type DriveFileSummary,
} from '@/adapters/drive/policy';
import { handOffFile } from '@/adapters/files/send';
import { WidgetFrame } from '@/components/shell/WidgetFrame';
import { cn } from '@/lib/cn';
import type { WidgetRenderProps } from '@/registry/types';

interface OpenedFile {
  id: string | null;
  name: string;
  mimeType: string;
  writable: boolean;
}

function formatWhen(value: string): string {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function textCopyName(name: string): string {
  const cleaned = name.trim() || 'note';
  if (/\.txt$/i.test(cleaned)) return cleaned.replace(/\.txt$/i, ' copy.txt');
  return `${cleaned}.txt`;
}

function Notice({ children }: { children: string }) {
  return (
    <p className="rounded-2xl border border-dashed border-amber-300/30 bg-black/20 px-3 py-3 text-sm leading-relaxed text-amber-100/90">
      {children}
    </p>
  );
}

export function DriveWidget({ widget }: WidgetRenderProps) {
  const [closedMessage, setClosedMessage] = useState<string | null>(() =>
    typeof window !== 'undefined' && !driveRequestsAllowed(window.location.hostname)
      ? PUBLIC_CLOSED_MESSAGE
      : null,
  );
  const [needsPassword, setNeedsPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [files, setFiles] = useState<DriveFileSummary[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [opened, setOpened] = useState<OpenedFile | null>(null);
  const [draft, setDraft] = useState('');
  const [reading, setReading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    if (opened) return;
    const hostname = window.location.hostname;
    if (!driveRequestsAllowed(hostname)) {
      setClosedMessage(PUBLIC_CLOSED_MESSAGE);
      setFiles([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setListError(null);
    loadDriveSession(hostname, controller.signal)
      .then(() => loadDriveFiles(hostname, controller.signal))
      .then((result) => {
        if (controller.signal.aborted) return;
        setNeedsPassword(false);
        setAuthError(null);
        setClosedMessage(null);
        setFiles(result.files);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setFiles([]);
        if (err instanceof DriveNeedsPasswordError) {
          setNeedsPassword(true);
          setClosedMessage(null);
          setAuthError(err.message);
          return;
        }
        setNeedsPassword(false);
        if (err instanceof DriveClosedError) {
          setClosedMessage(err.message);
          return;
        }
        setClosedMessage(null);
        if (err instanceof DriveUnreachableError) {
          setListError(err.message);
          return;
        }
        setListError(err instanceof Error ? err.message : 'Could not load Google Drive.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [opened, reloadKey]);

  function blockedReason(): string | null {
    if (!driveRequestsAllowed(window.location.hostname)) return PUBLIC_CLOSED_MESSAGE;
    if (needsPassword) return authError || 'Enter the Command Center password.';
    return closedMessage;
  }

  async function onUnlock(event: FormEvent) {
    event.preventDefault();
    const typed = password;
    setPassword('');
    if (!driveRequestsAllowed(window.location.hostname)) {
      setClosedMessage(PUBLIC_CLOSED_MESSAGE);
      setFiles([]);
      return;
    }
    if (!typed) {
      setNeedsPassword(true);
      setAuthError('Enter the Command Center password.');
      setFiles([]);
      return;
    }
    setUnlocking(true);
    setAuthError(null);
    try {
      await unlockDrive(window.location.hostname, typed);
      setNeedsPassword(false);
      setReloadKey((key) => key + 1);
    } catch (err) {
      setFiles([]);
      setOpened(null);
      setDraft('');
      if (err instanceof DriveNeedsPasswordError) {
        setNeedsPassword(true);
        setAuthError(err.message);
        return;
      }
      setAuthError(err instanceof Error ? err.message : 'Could not unlock Google Drive.');
    } finally {
      setUnlocking(false);
    }
  }

  async function openFile(id: string) {
    const reason = blockedReason();
    if (reason) {
      setClosedMessage(reason);
      setNotice(reason);
      return;
    }
    setReading(true);
    setNotice(null);
    setOpened({ id, name: 'Opening…', mimeType: '', writable: false });
    setDraft('');
    try {
      const file = await loadDriveFile(window.location.hostname, id);
      setOpened({ id: file.id, name: file.name, mimeType: file.mimeType, writable: file.writable });
      setDraft(file.content);
    } catch (err) {
      setOpened(null);
        if (err instanceof DriveNeedsPasswordError) {
          setNeedsPassword(true);
          setAuthError(err.message);
          setOpened(null);
          setDraft('');
        } else if (err instanceof DriveClosedError) {
          setClosedMessage(err.message);
          setNotice(err.message);
        } else {
          setListError(err instanceof Error ? err.message : 'Could not open that Drive file.');
        }
    } finally {
      setReading(false);
    }
  }

  function startNew() {
    const reason = blockedReason();
    if (reason) {
      setClosedMessage(reason);
      setNotice(reason);
      return;
    }
    const name = newName.trim();
    if (!name) {
      setNotice('Name the file first.');
      return;
    }
    setNotice(null);
    setOpened({ id: null, name, mimeType: 'text/plain', writable: true });
    setDraft('');
    setNewName('');
  }

  async function onSave() {
    if (!opened) return;
    const reason = blockedReason();
    if (reason) {
      setClosedMessage(reason);
      setNotice(reason);
      return;
    }
    setSaving(true);
    setNotice(null);
    const hostname = window.location.hostname;
    try {
      if (opened.id && opened.writable) {
        const saved = await updateDriveFile(hostname, opened.id, draft);
        setOpened({ id: saved.id, name: saved.name, mimeType: saved.mimeType, writable: true });
        setNotice(`Saved in Google Drive for ${DRIVE_ACCOUNT}.`);
        return;
      }
      const name = opened.id ? textCopyName(opened.name) : opened.name;
      const saved = await createDriveFile(hostname, { name, content: draft });
      setOpened({ id: saved.id, name: saved.name, mimeType: 'text/plain', writable: true });
      setNotice(
        opened.id
          ? `Saved a new text file in Google Drive for ${DRIVE_ACCOUNT}.`
          : `Saved in Google Drive for ${DRIVE_ACCOUNT}.`,
      );
    } catch (err) {
      if (err instanceof DriveNeedsPasswordError) {
        setNeedsPassword(true);
        setAuthError(err.message);
        setOpened(null);
        setFiles([]);
        setDraft('');
      } else if (err instanceof DriveClosedError) {
        setClosedMessage(err.message);
        setNotice(err.message);
      } else {
        setNotice(err instanceof Error ? err.message : 'Could not save that Drive file.');
      }
    } finally {
      setSaving(false);
    }
  }

  async function onSend() {
    if (!opened) return;
    const reason = blockedReason();
    if (reason) {
      setClosedMessage(reason);
      setNotice(reason);
      return;
    }
    setSending(true);
    try {
      const sent = await handOffFile({ name: opened.name, content: draft });
      setNotice(sent.message);
    } finally {
      setSending(false);
    }
  }

  const badge = needsPassword ? 'LOCKED' : closedMessage ? 'CLOSED' : listError ? 'SETUP' : 'LIVE';
  const showFiles = !needsPassword && !closedMessage && !listError;

  return (
    <WidgetFrame widget={widget} title="Google Drive" titleStyle={DRIVE_TITLE_STYLE} badge={badge}>
      <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.16em] text-white/40">{DRIVE_ACCOUNT}</p>
      {needsPassword ? (
        <form className="space-y-3" onSubmit={(event) => void onUnlock(event)}>
          <p className="text-sm leading-relaxed text-white/70">
            Enter the password to list, open, save, or send files in this Drive.
          </p>
          {authError ? <Notice>{authError}</Notice> : null}
          <label className="block text-xs text-white/55">
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              aria-label="Google Drive password"
              className="hud-input widget-no-drag mt-1 w-full"
            />
          </label>
          <button type="submit" className="hud-btn-primary widget-no-drag w-full" disabled={unlocking}>
            {unlocking ? 'Checking…' : 'Unlock'}
          </button>
        </form>
      ) : opened ? (
        <div>
          <button
            type="button"
            className="hud-btn-ghost widget-no-drag mb-3"
            onClick={() => {
              setOpened(null);
              setNotice(null);
              setReloadKey((key) => key + 1);
            }}
          >
            Back
          </button>
          <h4 className="mb-2 truncate text-sm text-white">{opened.name}</h4>
          {reading ? <p className="mb-2 text-sm text-white/55">Opening file…</p> : null}
          {opened.id && !opened.writable && !reading ? (
            <p className="mb-2 text-xs leading-relaxed text-white/55">
              This Google file is shown as text. Save writes a new text file in Drive.
            </p>
          ) : null}
          <label className="block text-xs text-white/55">
            Contents
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={8}
              className="hud-input widget-no-drag mt-1 w-full resize-y font-mono text-xs"
              placeholder="Type the file, then Save."
              aria-label="Drive file contents"
            />
          </label>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="hud-btn-primary widget-no-drag flex-1"
              disabled={saving || reading}
              onClick={() => void onSave()}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              className="hud-btn-ghost widget-no-drag flex-1"
              disabled={sending || reading}
              onClick={() => void onSend()}
            >
              {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
          {notice ? <p className="mt-2 text-sm leading-relaxed text-cyan-100/90">{notice}</p> : null}
          <p className="mt-2 text-[11px] leading-relaxed text-white/40">
            Send uses this phone’s share sheet when the browser allows it. Otherwise the file downloads in this browser.
          </p>
        </div>
      ) : (
        <>
          {closedMessage ? <Notice>{closedMessage}</Notice> : null}
          {listError ? <Notice>{listError}</Notice> : null}
          {showFiles ? (
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs text-white/45">{loading ? 'Loading the newest 25…' : 'Newest 25'}</p>
              <button
                type="button"
                className="hud-btn-ghost widget-no-drag h-11 w-11 shrink-0 px-0 disabled:opacity-50"
                aria-label="Refresh Google Drive"
                disabled={loading}
                onClick={() => setReloadKey((key) => key + 1)}
              >
                <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              </button>
            </div>
          ) : null}
          {showFiles && !loading && files.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-white/15 bg-black/20 px-3 py-6 text-center text-sm text-white/50">
              Drive has no files to show.
            </p>
          ) : null}
          {showFiles ? <ul className="space-y-2">
            {files.map((file) => (
              <li key={file.id}>
                <button
                  type="button"
                  className="widget-no-drag w-full rounded-xl bg-white/5 px-3 py-2.5 text-left hover:bg-white/10"
                  onClick={() => void openFile(file.id)}
                >
                  <span className="block truncate text-sm text-white">{file.name}</span>
                  <span className="mt-1 block font-mono text-[10px] text-white/40">{formatWhen(file.modifiedTime)}</span>
                </button>
              </li>
            ))}
          </ul> : null}
          {showFiles ? <form
            className="mt-3 flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              startNew();
            }}
          >
            <input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="New file name"
              aria-label="New Drive file name"
              className="hud-input widget-no-drag flex-1"
            />
            <button type="submit" className="hud-btn-ghost widget-no-drag">
              New
            </button>
          </form> : null}
          {notice ? <p className="mt-2 text-sm leading-relaxed text-cyan-100/90">{notice}</p> : null}
          <p className="mt-3 text-[11px] leading-relaxed text-white/40">
            Google Drive for this account. Files kept on this device stay in the Files widget.
          </p>
        </>
      )}
    </WidgetFrame>
  );
}
