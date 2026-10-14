import { create } from 'zustand';
import { uid } from '@/lib/ids';
import { readJson, writeJson } from '@/store/persist';
import { applyFileSave, MAX_FILE_CHARS } from './fileDocument';

export interface FileNode {
  id: string;
  name: string;
  kind: 'folder' | 'file';
  parentId: string | null;
  content?: string;
  updatedAt: number;
}

const ROOT_FOLDERS = ['Projects', 'Trades', 'Builds', 'Media', 'Backtests'] as const;
const KEY = 'files';

export { MAX_FILE_CHARS };

function seed(): FileNode[] {
  return ROOT_FOLDERS.map((name) => ({
    id: `folder_${name.toLowerCase()}`,
    name,
    kind: 'folder' as const,
    parentId: null,
    updatedAt: Date.now(),
  }));
}

function load(): FileNode[] {
  const saved = readJson<FileNode[] | null>(KEY, null);
  if (saved && saved.length) return saved;
  return seed();
}

interface FilesState {
  nodes: FileNode[];
  query: string;
  currentFolderId: string | null;
  setQuery: (q: string) => void;
  openFolder: (id: string | null) => void;
  addFile: (parentId: string | null, name: string, content?: string) => string;
  saveFile: (id: string, content: string) => { ok: true } | { ok: false; error: string };
  addFolder: (parentId: string | null, name: string) => void;
  addMediaUrl: (prompt: string, url: string) => void;
  rename: (id: string, name: string) => void;
  remove: (id: string) => void;
}

function save(nodes: FileNode[]) {
  writeJson(KEY, nodes);
}

export const useFilesStore = create<FilesState>((set, get) => ({
  nodes: load(),
  query: '',
  currentFolderId: null,
  setQuery: (query) => set({ query }),
  openFolder: (currentFolderId) => set({ currentFolderId }),
  addFile: (parentId, name, content = '') => {
    if (content.length > MAX_FILE_CHARS) return '';
    const id = uid('file');
    const nodes = [
      ...get().nodes,
      {
        id,
        name,
        kind: 'file' as const,
        parentId,
        content,
        updatedAt: Date.now(),
      },
    ];
    save(nodes);
    set({ nodes });
    return id;
  },
  saveFile: (id, content) => {
    const drafted = applyFileSave(get().nodes, id, content);
    if (!drafted.ok) return drafted;
    save(drafted.nodes);
    set({ nodes: drafted.nodes });
    return { ok: true };
  },
  addMediaUrl: (prompt, url) => {
    const folderId = 'folder_media';
    let nodes = get().nodes;
    if (!nodes.some((n) => n.id === folderId)) {
      nodes = [
        ...nodes,
        { id: folderId, name: 'Media', kind: 'folder' as const, parentId: null, updatedAt: Date.now() },
      ];
    }
    const label = prompt.trim().slice(0, 48) || 'Wan 2.2 clip';
    nodes = [
      ...nodes,
      {
        id: uid('file'),
        name: `${label}.mp4`,
        kind: 'file' as const,
        parentId: folderId,
        content: url,
        updatedAt: Date.now(),
      },
    ].slice(0, 400);
    save(nodes);
    set({ nodes });
  },
  addFolder: (parentId, name) => {
    const nodes = [
      ...get().nodes,
      { id: uid('folder'), name, kind: 'folder' as const, parentId, updatedAt: Date.now() },
    ];
    save(nodes);
    set({ nodes });
  },
  rename: (id, name) => {
    const nodes = get().nodes.map((n) => (n.id === id ? { ...n, name, updatedAt: Date.now() } : n));
    save(nodes);
    set({ nodes });
  },
  remove: (id) => {
    const drop = new Set<string>([id]);
    const nodes = get().nodes;
    let grew = true;
    while (grew) {
      grew = false;
      for (const n of nodes) {
        if (n.parentId && drop.has(n.parentId) && !drop.has(n.id)) {
          drop.add(n.id);
          grew = true;
        }
      }
    }
    const next = nodes.filter((n) => !drop.has(n.id));
    save(next);
    set({ nodes: next, currentFolderId: drop.has(get().currentFolderId ?? '') ? null : get().currentFolderId });
  },
}));
