import { BOSS, PERSONAS, type SpecialistId } from "./personas.js";

export type Speaker = "boss" | SpecialistId;

export interface Line {
  speaker: Speaker;
  text: string;
}

export function renderDesk(lines: Line[]): string {
  return lines
    .map((line) => {
      const who =
        line.speaker === "boss"
          ? BOSS
          : PERSONAS[line.speaker];
      return `${who.emoji} <b>${escapeHtml(who.name)}</b>\n${escapeHtml(line.text)}`;
    })
    .join("\n\n");
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
