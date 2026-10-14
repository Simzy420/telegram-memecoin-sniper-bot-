import {
  WAN_CALL_PATH,
  WAN_SPACE_ORIGIN,
  WAN_TIMEOUT_MS,
} from './constants';
import { WanCorsError, WanTimeoutError, type GradioFileData, type WanGenerateInput, type WanProgress } from './types';

export function fileToFileData(file: File): Promise<GradioFileData> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result ?? '');
      if (!url.startsWith('data:')) {
        reject(new Error('Could not encode the image as a data URL.'));
        return;
      }
      resolve({
        path: null,
        url,
        orig_name: file.name || 'input.png',
        size: file.size,
        mime_type: file.type || guessMime(file.name),
        is_stream: false,
        meta: { _type: 'gradio.FileData' },
      });
    };
    reader.onerror = () => reject(new Error('Could not read that image.'));
    reader.readAsDataURL(file);
  });
}

function guessMime(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  return 'image/png';
}

export function isCorsFailure(err: unknown): boolean {
  if (err instanceof WanCorsError) return true;
  if (err instanceof TypeError) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /failed to fetch|networkerror|load failed|cors/i.test(msg);
}

export async function probeWanCors(): Promise<boolean> {
  try {
    const res = await fetch(`${WAN_SPACE_ORIGIN}/config`, { method: 'GET', mode: 'cors' });
    return res.ok;
  } catch {
    return false;
  }
}

function absUrl(url: string, origin: string): string {
  if (!url) return url;
  if (/^(https?:|data:|blob:)/i.test(url)) return url;
  try {
    return new URL(url, origin).href;
  } catch {
    return `${origin}${url.startsWith('/') ? '' : '/'}${url}`;
  }
}

function looksLikeVideoRef(value: string): boolean {
  return (
    /\/gradio_api\/file/i.test(value) ||
    /\.(mp4|webm|mov|mkv)(\?|$)/i.test(value) ||
    value.startsWith('http') ||
    value.startsWith('/')
  );
}

function pickUrl(node: unknown, depth = 0): string | null {
  if (node == null || depth > 6) return null;
  if (typeof node === 'string') return looksLikeVideoRef(node) ? node : null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = pickUrl(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof node !== 'object') return null;
  const rec = node as Record<string, unknown>;
  if (rec.video) {
    const nested = pickUrl(rec.video, depth + 1);
    if (nested) return nested;
  }
  if (typeof rec.url === 'string' && rec.url) return rec.url;
  if (typeof rec.path === 'string' && rec.path && looksLikeVideoRef(rec.path)) return rec.path;
  for (const value of Object.values(rec)) {
    const found = pickUrl(value, depth + 1);
    if (found) return found;
  }
  return null;
}

function pickSeed(payload: unknown): number | undefined {
  if (!Array.isArray(payload)) return undefined;
  const last = payload[payload.length - 1];
  return typeof last === 'number' && Number.isFinite(last) ? last : undefined;
}

function parseJsonLoose(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === 'null') return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return trimmed;
  }
}

function humanSpaceError(payload: unknown, fallback: string): string {
  if (typeof payload === 'string' && payload.trim()) return payload.trim();
  if (payload && typeof payload === 'object') {
    const rec = payload as Record<string, unknown>;
    const msg = rec.error ?? rec.message ?? rec.msg ?? rec.detail;
    if (typeof msg === 'string' && msg.trim()) return msg.trim();
  }
  return fallback;
}

function elapsedLabel(elapsedMs: number): string {
  const sec = Math.max(1, Math.round(elapsedMs / 1000));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

async function readSse(
  response: Response,
  startedAt: number,
  onProgress: (p: WanProgress) => void,
  timeoutMs: number,
): Promise<{ data: unknown }> {
  if (!response.body) throw new Error('Space event stream had no body.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let eventName = 'message';
  let dataLines: string[] = [];

  const flush = (): { done?: boolean; data?: unknown } => {
    if (dataLines.length === 0 && !eventName) return {};
    const raw = dataLines.join('\n');
    dataLines = [];
    const ev = eventName || 'message';
    eventName = 'message';
    if (!raw) return {};
    const payload = parseJsonLoose(raw);
    const elapsedMs = Date.now() - startedAt;

    if (ev === 'heartbeat') {
      onProgress({
        phase: 'generating',
        detail: `Still generating — ${elapsedLabel(elapsedMs)} elapsed. ZeroGPU often takes 1–3 minutes.`,
        elapsedMs,
      });
      return {};
    }
    if (ev === 'estimation' || ev === 'queue' || ev === 'queued') {
      const rec = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
      const rank = rec.rank ?? rec.position;
      const size = rec.queue_size ?? rec.queueSize;
      const eta = rec.rank_eta ?? rec.eta;
      const bits = [
        rank != null ? `place ${String(rank)}` : null,
        size != null ? `of ${String(size)}` : null,
        eta != null ? `~${Math.round(Number(eta))}s` : null,
      ].filter(Boolean);
      onProgress({
        phase: 'queued',
        detail: bits.length ? `Queued on ZeroGPU (${bits.join(', ')}).` : 'Queued on Hugging Face ZeroGPU…',
        elapsedMs,
      });
      return {};
    }
    if (ev === 'error' || ev === 'unexpected_error') {
      throw new Error(
        humanSpaceError(
          payload,
          'Space returned an error with no details. Try a larger still, or retry — ZeroGPU queues fill up.',
        ),
      );
    }
    if (ev === 'complete') {
      return { done: true, data: payload };
    }
    if (ev === 'generating' || ev === 'process_generating') {
      onProgress({
        phase: 'generating',
        detail: `Generating video — ${elapsedLabel(elapsedMs)} elapsed. This often takes 1–3 minutes.`,
        elapsedMs,
      });
      return {};
    }
    if (payload && typeof payload === 'object') {
      const rec = payload as Record<string, unknown>;
      const msg = rec.msg;
      if (msg === 'process_completed' || msg === 'complete') {
        const output = rec.output;
        const data =
          output && typeof output === 'object' && 'data' in output
            ? (output as { data: unknown }).data
            : rec.data ?? payload;
        return { done: true, data };
      }
      if (msg === 'estimation' || msg === 'queue_full' || msg === 'process_starts') {
        if (msg === 'queue_full') throw new Error('ZeroGPU queue is full. Wait a moment, then try again.');
        onProgress({
          phase: msg === 'process_starts' ? 'generating' : 'queued',
          detail:
            msg === 'process_starts'
              ? `Generating video — ${elapsedLabel(elapsedMs)} elapsed.`
              : 'Queued on Hugging Face ZeroGPU…',
          elapsedMs,
        });
      }
    }
    return {};
  };

  while (true) {
    if (Date.now() - startedAt > timeoutMs) throw new WanTimeoutError(Date.now() - startedAt);
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    buf = buf.replace(/\r\n/g, '\n');
    let idx: number;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
        continue;
      }
      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart());
        continue;
      }
      if (line === '') {
        const result = flush();
        if (result.done) return { data: result.data };
      }
    }
  }
  if (dataLines.length) {
    const result = flush();
    if (result.done) return { data: result.data };
  }
  throw new Error('Space event stream ended before the video was ready.');
}

async function postCall(data: unknown[], signal: AbortSignal): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${WAN_SPACE_ORIGIN}${WAN_CALL_PATH}`, {
      method: 'POST',
      mode: 'cors',
      signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ data }),
    });
  } catch (err) {
    if (signal.aborted) throw new WanTimeoutError(WAN_TIMEOUT_MS);
    if (isCorsFailure(err)) throw new WanCorsError();
    throw err;
  }
  if (res.status === 429) throw new Error('ZeroGPU is rate-limited or queue is full. Try again in a minute.');
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(humanSpaceError(parseJsonLoose(text), `Space POST failed (${res.status}).`));
  }
  const body = (await res.json()) as { event_id?: string; eventId?: string };
  const eventId = body.event_id ?? body.eventId;
  if (!eventId) throw new Error('Space did not return an event id.');
  return eventId;
}

async function pollCall(
  eventId: string,
  startedAt: number,
  onProgress: (p: WanProgress) => void,
  signal: AbortSignal,
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${WAN_SPACE_ORIGIN}${WAN_CALL_PATH}/${eventId}`, {
      method: 'GET',
      mode: 'cors',
      signal,
      headers: { Accept: 'text/event-stream' },
    });
  } catch (err) {
    if (signal.aborted) throw new WanTimeoutError(Date.now() - startedAt);
    if (isCorsFailure(err)) throw new WanCorsError();
    throw err;
  }
  if (res.status === 429) throw new Error('ZeroGPU queue rejected the poll. Try again shortly.');
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(humanSpaceError(parseJsonLoose(text), `Space poll failed (${res.status}).`));
  }
  const { data } = await readSse(res, startedAt, onProgress, WAN_TIMEOUT_MS);
  return data;
}

export async function generateWanVideo(
  input: WanGenerateInput,
  onProgress: (p: WanProgress) => void = () => undefined,
): Promise<{ url: string; seed?: number }> {
  const startedAt = Date.now();
  onProgress({ phase: 'upload', detail: 'Encoding image for Wan 2.2…', elapsedMs: 0 });
  const inputImage = await fileToFileData(input.inputImage);
  const lastImage = input.lastImage ? await fileToFileData(input.lastImage) : null;

  const data = [
    inputImage,
    lastImage,
    input.prompt,
    input.steps,
    input.negativePrompt,
    input.durationSeconds,
    input.guidanceScale,
    input.guidanceScale2,
    input.seed,
    input.randomizeSeed,
    input.quality,
    input.scheduler,
    input.flowShift,
    input.frameMultiplier,
    input.videoComponent,
    input.safeMode,
  ];

  onProgress({
    phase: 'queued',
    detail: 'Sending to Hugging Face Space… ZeroGPU can take 1–3 minutes.',
    elapsedMs: Date.now() - startedAt,
  });

  const ac = new AbortController();
  const killer = window.setTimeout(() => ac.abort(), WAN_TIMEOUT_MS);
  const tick = window.setInterval(() => {
    const elapsedMs = Date.now() - startedAt;
    onProgress({
      phase: 'generating',
      detail: `Waiting on ZeroGPU — ${elapsedLabel(elapsedMs)} elapsed. This often takes 1–3 minutes.`,
      elapsedMs,
    });
  }, 5000);

  try {
    const eventId = await postCall(data, ac.signal);
    onProgress({
      phase: 'polling',
      detail: 'Queued / generating on ZeroGPU. Keeping this tab open…',
      elapsedMs: Date.now() - startedAt,
    });
    const result = await pollCall(eventId, startedAt, onProgress, ac.signal);
    const rel = pickUrl(result);
    if (!rel) throw new Error('Space finished but did not return a video URL.');
    return { url: absUrl(rel, WAN_SPACE_ORIGIN), seed: pickSeed(result) };
  } catch (err) {
    if (ac.signal.aborted) throw new WanTimeoutError(Date.now() - startedAt);
    throw err;
  } finally {
    window.clearTimeout(killer);
    window.clearInterval(tick);
  }
}
