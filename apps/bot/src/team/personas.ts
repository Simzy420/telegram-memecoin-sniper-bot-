export const SPECIALISTS = [
  { mark: "◈", name: "Scout", role: "finds pairs and setups" },
  { mark: "◎", name: "Sniper", role: "memecoin entries" },
  { mark: "▹", name: "Pulse", role: "rapid day trader / tape" },
  { mark: "▤", name: "Ledger", role: "positions, fills, day log" },
  { mark: "▣", name: "Shield", role: "risk filters before entry" },
] as const;

export const SPECIALIST_IDS = [
  "scout",
  "sniper",
  "pulse",
  "ledger",
  "shield",
] as const;

export type SpecialistId = (typeof SPECIALIST_IDS)[number];

export interface Persona {
  id: SpecialistId;
  name: string;
  mark: string;
  emoji: string;
  role: string;
}

export const BOSS = {
  id: "boss" as const,
  name: "Big Brain Ape",
  emoji: "🦍",
  mark: "♛",
};

const EMOJI: Record<SpecialistId, string> = {
  scout: "🔭",
  sniper: "🎯",
  pulse: "📡",
  ledger: "📒",
  shield: "🛡️",
};

export const PERSONAS: Record<SpecialistId, Persona> = Object.fromEntries(
  SPECIALISTS.map((s) => {
    const id = s.name.toLowerCase() as SpecialistId;
    return [id, { id, name: s.name, mark: s.mark, emoji: EMOJI[id], role: s.role }];
  }),
) as Record<SpecialistId, Persona>;

export function personaNameList(ids: SpecialistId[]): string {
  return ids.map((id) => PERSONAS[id].name).join(", ");
}
