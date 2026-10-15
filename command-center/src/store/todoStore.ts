import { create } from 'zustand';
import { uid } from '@/lib/ids';
import { readJson, writeJson } from '@/store/persist';

export interface TodoItem {
  id: string;
  text: string;
  done: boolean;
  createdAt: number;
}

const KEY = 'todos';

function load(): TodoItem[] {
  return readJson<TodoItem[]>(KEY, [
    { id: uid('todo'), text: 'Tear down the starter board in Edit mode', done: false, createdAt: Date.now() },
    { id: uid('todo'), text: 'Connect a real data source (no fake charts)', done: false, createdAt: Date.now() },
  ]);
}

interface TodoState {
  items: TodoItem[];
  add: (text: string) => void;
  toggle: (id: string) => void;
  remove: (id: string) => void;
}

function save(items: TodoItem[]) {
  writeJson(KEY, items);
}

export const useTodoStore = create<TodoState>((set, get) => ({
  items: load(),
  add: (text) => {
    const items = [{ id: uid('todo'), text, done: false, createdAt: Date.now() }, ...get().items];
    save(items);
    set({ items });
  },
  toggle: (id) => {
    const items = get().items.map((t) => (t.id === id ? { ...t, done: !t.done } : t));
    save(items);
    set({ items });
  },
  remove: (id) => {
    const items = get().items.filter((t) => t.id !== id);
    save(items);
    set({ items });
  },
}));
