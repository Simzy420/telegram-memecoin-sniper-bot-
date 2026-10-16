import { create } from 'zustand';
import { uid } from '@/lib/ids';
import { readJson, writeJson } from '@/store/persist';

export interface ActivityEvent {
  id: string;
  at: number;
  botId?: string;
  kind: 'message' | 'observe' | 'system' | 'image' | 'video';
  text: string;
}

const KEY = 'activity';
const MAX = 80;

function load(): ActivityEvent[] {
  return readJson<ActivityEvent[]>(KEY, []);
}

interface ActivityState {
  events: ActivityEvent[];
  push: (event: Omit<ActivityEvent, 'id' | 'at'>) => void;
  clear: () => void;
}

function save(events: ActivityEvent[]) {
  writeJson(KEY, events);
}

export const useActivityStore = create<ActivityState>((set, get) => ({
  events: load(),
  push: (event) => {
    const events = [{ id: uid('act'), at: Date.now(), ...event }, ...get().events].slice(0, MAX);
    save(events);
    set({ events });
  },
  clear: () => {
    save([]);
    set({ events: [] });
  },
}));
