import type { Line, Speaker } from "./render.js";

const SPEAKERS = new Set<Speaker>([
  "boss",
  "scout",
  "sniper",
  "pulse",
  "ledger",
  "shield",
]);

/**
 * Optional color for chat lines. Facts (fills, verdicts, cash) stay on the
 * deterministic path. A bad or boastful model reply is discarded.
 */
export async function flavorChat(
  lines: Line[],
  apiKey: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<Line[] | null> {
  if (!apiKey) return null;
  try {
    const res = await fetchImpl("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.4,
        max_tokens: 500,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You write short Telegram lines for Big Brain Ape The MemeCoin Sniper. " +
              "Big Brain Ape is the boss. Specialists are Scout, Sniper, Pulse, Ledger, and Shield. " +
              "Paper mode only. Never say a transaction was sent, signed, or filled on-chain. " +
              "Never invent balances. Never mention ClawdAgents or other products. " +
              'Return JSON {"lines":[{"speaker":"boss|scout|sniper|pulse|ledger|shield","text":"..."}]} ' +
              "with the same speakers in the same order. Each text under 280 characters.",
          },
          {
            role: "user",
            content: JSON.stringify({
              lines: lines.map((l) => ({ speaker: l.speaker, text: l.text })),
            }),
          },
        ],
      }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = body.choices?.[0]?.message?.content;
    if (!content) return null;
    return parseFlavor(content, lines);
  } catch {
    return null;
  }
}

export function parseFlavor(content: string, original: Line[]): Line[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  const rows = (parsed as { lines?: unknown }).lines;
  if (!Array.isArray(rows) || rows.length !== original.length) return null;
  const next: Line[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as { speaker?: string; text?: string };
    const speaker = row.speaker as Speaker;
    if (speaker !== original[i]?.speaker || !SPEAKERS.has(speaker)) return null;
    const text = (row.text ?? "").trim();
    if (!text || text.length > 320) return null;
    if (/broadcast|transaction (sent|signed|confirmed)|on-chain fill|clawd/i.test(text)) {
      return null;
    }
    next.push({ speaker, text });
  }
  return next;
}
