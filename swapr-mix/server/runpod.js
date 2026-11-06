/**
 * Swapr Mix — Runpod Wan Animate serverless endpoint
 * (wlsdml1114/Wan_Animate_Runpod_hub handler).
 *
 * This fork is separate from original Swapr (wan22-templates main).
 * Mix always sends SAM control points. Green marks each person to replace.
 * Red marks each prop to replace. The handler accepts one reference image:
 * the phone composites every face left to right into image_base64 (one face
 * is unchanged). The prop still is inset into that image, and also sent as
 * prop_image_base64.
 *
 * POST {endpoint}/run, then poll {endpoint}/status/{id}.
 * The handler accepts image_base64 plus a public video_url, and returns
 * a base64 mp4 on output.video (Comfy gifs encoded as base64).
 * The API key stays in this process. Callers never send it to the phone.
 */

import {
  MIX_DEFAULT_NEGATIVE,
  buildMaskPointFields,
  mixPrompt,
  normalizePoints,
} from "./mixPoints.js";
import { compositeReferenceBase64 } from "./referenceStill.js";

export const TEMPLATE_CATALOG_URL =
  "https://huggingface.co/datasets/Simzy/wan22-template-clips/resolve/main/templates/catalog.json";
export const TEMPLATE_CDN_BASE =
  "https://huggingface.co/datasets/Simzy/wan22-template-clips/resolve/main/";

const RUNPOD_DEFAULTS = {
  negative_prompt: MIX_DEFAULT_NEGATIVE,
  // Template clips are phone recordings (portrait). 832x480 landscape made the
  // worker's VHS_LoadVideo crop the motion clip, cutting the head in half.
  width: 480,
  height: 832,
  fps: 16,
  cfg: 1,
  steps: 5,
  mode: "replace",
};

const CREDIT_RE = /credit|insufficient|billing|payment required|out of funds|balance/i;
const AUTH_RE = /unauthorized|invalid api key|forbidden|api key/i;

/** swapr-wan-animate on account 1. Used when the API key is set and RUNPOD_ENDPOINT_ID is empty. */
export const DEFAULT_ANIMATE_ENDPOINT_ID = "zrmwpir4qzs66s";
/** swapr-wan-animate on account 2. Used only when RUNPOD_API_KEY_2 is set and RUNPOD_ENDPOINT_ID_2 is empty. */
export const DEFAULT_ANIMATE_ENDPOINT_ID_2 = "3qu6rstqmkum81";
const BALANCE_TTL_MS = 30_000;
const GRAPHQL_URL = "https://api.runpod.io/graphql";
const BALANCE_QUERY = "query { myself { clientBalance currentSpendPerHr } }";
const balanceCache = new Map();

const MAX_STILL_BYTES = 2_000_000;

export function hfGenerateEnabled(env = {}) {
  const flag = String(env.HF_GENERATE_FALLBACK || "").trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
}

export function runpodEndpointId(env = {}) {
  const id = String(env.RUNPOD_ENDPOINT_ID || "").trim();
  if (id) return id;
  if (String(env.RUNPOD_API_KEY || "").trim()) return DEFAULT_ANIMATE_ENDPOINT_ID;
  return "";
}

export function runpodConfigured(env = {}) {
  return listRunpodAccounts(env).length > 0;
}

/**
 * Keep a configured URL only when it is this account's own api.runpod.ai endpoint.
 * A URL for the other account falls back to https://api.runpod.ai/v2/<id>.
 */
export function sanitizeRunpodEndpoint(id, rawUrl) {
  const fallback = id ? `https://api.runpod.ai/v2/${id}` : "";
  const raw = String(rawUrl || "").trim();
  if (!raw) return fallback;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" || parsed.hostname !== "api.runpod.ai") return fallback;
    parsed.hash = "";
    parsed.search = "";
    parsed.username = "";
    parsed.password = "";
    const cleaned = parsed.toString().replace(/\/$/, "").replace(/\/(?:run|runsync|status)$/i, "");
    if (id && !cleaned.endsWith(`/${id}`)) return fallback;
    return cleaned;
  } catch {
    return fallback;
  }
}

export function runpodEndpoint(env = {}) {
  return sanitizeRunpodEndpoint(runpodEndpointId(env), env.RUNPOD_ENDPOINT_URL);
}

const ACCOUNT_DEFS = [
  {
    slot: "1",
    label: "Runpod 1",
    key: "RUNPOD_API_KEY",
    id: "RUNPOD_ENDPOINT_ID",
    url: "RUNPOD_ENDPOINT_URL",
    fallbackId: DEFAULT_ANIMATE_ENDPOINT_ID,
  },
  {
    slot: "2",
    label: "Runpod 2",
    key: "RUNPOD_API_KEY_2",
    id: "RUNPOD_ENDPOINT_ID_2",
    url: "RUNPOD_ENDPOINT_URL_2",
    fallbackId: DEFAULT_ANIMATE_ENDPOINT_ID_2,
  },
];

/** Accounts whose API key is set. Each key is paired only with its own endpoint. */
export function listRunpodAccounts(env = {}) {
  const accounts = [];
  for (const def of ACCOUNT_DEFS) {
    const apiKey = String(env[def.key] || "").trim();
    if (!apiKey) continue;
    const endpointId = String(env[def.id] || "").trim() || def.fallbackId;
    const endpoint = sanitizeRunpodEndpoint(endpointId, env[def.url]);
    if (!endpointId || !endpoint) continue;
    accounts.push({ slot: def.slot, label: def.label, apiKey, endpointId, endpoint });
  }
  return accounts;
}

export function clearRunpodBalanceCache() {
  balanceCache.clear();
}

export async function queryRunpodBalance(apiKey, deps = {}) {
  const fetchImpl = deps.fetch || fetch;
  const timeoutMs = deps.balanceTimeoutMs ?? 10000;
  let response;
  try {
    response = await fetchWithTimeout(
      fetchImpl,
      GRAPHQL_URL,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ query: BALANCE_QUERY }),
      },
      timeoutMs
    );
  } catch (error) {
    const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
    throw new Error(timedOut ? "Runpod balance timed out." : "Could not reach Runpod balance.");
  }
  const text = typeof response.text === "function" ? await response.text() : "";
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = {};
  }
  if (!response.ok || body.errors?.length) {
    const message = body.errors?.map((entry) => entry.message).join("; ") || `Runpod GraphQL HTTP ${response.status}`;
    throw new Error(message);
  }
  const me = body.data?.myself || {};
  return {
    balance: typeof me.clientBalance === "number" ? me.clientBalance : null,
    spendPerHour: typeof me.currentSpendPerHr === "number" ? me.currentSpendPerHr : null,
    at: new Date().toISOString(),
  };
}

export async function cachedRunpodBalance(apiKey, deps = {}) {
  const cache = deps.cache || balanceCache;
  const now = typeof deps.now === "function" ? deps.now() : Date.now();
  const ttl = Number.isFinite(deps.balanceTtlMs) ? deps.balanceTtlMs : BALANCE_TTL_MS;
  const hit = cache.get(apiKey);
  if (hit && now - hit.storedAt < ttl) return hit.value;
  const value = await queryRunpodBalance(apiKey, deps);
  cache.set(apiKey, { storedAt: now, value });
  return value;
}

async function rankAccountsByBalance(accounts, deps) {
  const scored = await Promise.all(
    accounts.map(async (account) => {
      try {
        const info = await cachedRunpodBalance(account.apiKey, deps);
        const balance = typeof info.balance === "number" ? info.balance : Number.NEGATIVE_INFINITY;
        return { account, balance };
      } catch {
        return { account, balance: Number.NEGATIVE_INFINITY };
      }
    })
  );
  scored.sort((a, b) => b.balance - a.balance || Number(a.account.slot) - Number(b.account.slot));
  return scored.map((row) => row.account);
}

const JOB_TAG = /^rp([12])_([A-Za-z0-9_-]{6,80})$/;

/** Prefix the Runpod id so status and cancel stay on the account that accepted /run. */
export function tagRunpodJobId(slot, rawId, enabled) {
  if (!enabled) return rawId;
  return `rp${slot}_${rawId}`;
}

export function parseRunpodJobId(value) {
  const text = String(value || "");
  const match = JOB_TAG.exec(text);
  if (!match) return { slot: "", rawId: text, tagged: false };
  return { slot: match[1], rawId: match[2], tagged: true };
}

export function resolveRunpodAccount(env, jobId) {
  const accounts = listRunpodAccounts(env);
  const parsed = parseRunpodJobId(jobId);
  if (!accounts.length) return { account: null, ...parsed, missingSlot: "" };
  if (parsed.tagged) {
    const account = accounts.find((entry) => entry.slot === parsed.slot) || null;
    return { account, ...parsed, missingSlot: account ? "" : parsed.slot };
  }
  const account = accounts.find((entry) => entry.slot === "1") || accounts[0];
  return { account, ...parsed, missingSlot: "" };
}

export function isRunpodCreditError(error) {
  if (!error) return false;
  if (error.statusCode === 402 || error.credit) return true;
  const message = error instanceof Error ? error.message : String(error);
  return CREDIT_RE.test(message);
}

export function resultVideoKey(jobId) {
  return `result-video:${jobId}`;
}

export function isAllowedTemplateVideoUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || "").trim());
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  if (parsed.username || parsed.password) return false;
  const host = parsed.hostname.toLowerCase();
  if (host !== "huggingface.co" && !host.endsWith(".huggingface.co")) return false;
  return /wan22-template-clips/i.test(parsed.pathname);
}

export function templateVideoFromCatalog(catalog, templateId) {
  if (!Array.isArray(catalog) || !templateId) return null;
  const item = catalog.find((entry) => entry && entry.id === templateId);
  if (!item) return null;
  if (typeof item.video_url === "string" && isAllowedTemplateVideoUrl(item.video_url)) return item.video_url;
  const rel = item.video_path || item.video || "";
  if (!rel || typeof rel !== "string") return null;
  const url = TEMPLATE_CDN_BASE + rel.replace(/^\//, "");
  return isAllowedTemplateVideoUrl(url) ? url : null;
}

export async function resolveMotionVideoUrl(payload, deps = {}) {
  const source = payload && typeof payload === "object" ? payload : {};
  const direct = typeof source.video_url === "string" ? source.video_url.trim() : "";
  if (direct && isAllowedTemplateVideoUrl(direct)) return direct;
  const templateId = typeof source.template_id === "string" ? source.template_id.trim() : "";
  if (!templateId) {
    throw new Error("Pick a motion template before Generate.");
  }
  const fetchImpl = deps.fetch || fetch;
  const catalogUrl = deps.catalogUrl || TEMPLATE_CATALOG_URL;
  let response;
  try {
    response = await fetchWithTimeout(fetchImpl, catalogUrl, {}, deps.timeoutMs ?? 15000);
  } catch {
    throw new Error("Could not load the motion catalog to find that template video. Try Generate again.");
  }
  if (!response?.ok) {
    throw new Error(`Could not load the motion catalog (HTTP ${response?.status || "error"}).`);
  }
  let catalog;
  try {
    catalog = await response.json();
  } catch {
    throw new Error("The motion catalog was not valid JSON.");
  }
  const url = templateVideoFromCatalog(catalog, templateId);
  if (!url) throw new Error(`No public video for template “${templateId}”. Refresh the gallery and pick the motion again.`);
  return url;
}

function normalizeSeed(seed) {
  const n = Number(seed);
  if (Number.isFinite(n)) return Math.max(0, Math.floor(n));
  return Math.floor(Math.random() * 1_000_000_000);
}

/**
 * Pick the worker width/height from the template's aspect. The worker feeds
 * width/height to VHS_LoadVideo (crops the motion clip to that aspect) and to
 * ImageResizeKJv2 (pads the reference still), so they must match the clip.
 */
export function targetSize(fields = {}) {
  const w = Number(fields.template_width);
  const h = Number(fields.template_height);
  let orientation = String(fields.orientation || "").toLowerCase();
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    const ratio = w / h;
    orientation = ratio > 1.15 ? "landscape" : ratio < 0.87 ? "portrait" : "square";
  }
  if (orientation === "landscape") return { width: 832, height: 480 };
  if (orientation === "square") return { width: 640, height: 640 };
  return { width: RUNPOD_DEFAULTS.width, height: RUNPOD_DEFAULTS.height };
}

export function assertMixMarks(fields = {}, { hasPropImage = false } = {}) {
  if (!normalizePoints(fields.positive_points).length && !(typeof fields.coordinates === "string" && fields.coordinates.trim())) {
    const error = new Error("Tap the person to replace (green) before Generate.");
    error.statusCode = 400;
    throw error;
  }
  const prop = normalizePoints(fields.prop_points);
  if (prop.length && !hasPropImage) {
    const error = new Error("Upload a replacement image for the red-dot prop before Generate.");
    error.statusCode = 400;
    throw error;
  }
  if (hasPropImage && !prop.length) {
    const error = new Error("Tap the prop to replace (red) before Generate.");
    error.statusCode = 400;
    throw error;
  }
}

export function buildRunpodInput(fields = {}) {
  if (!fields.image_base64 || typeof fields.image_base64 !== "string") {
    throw new Error("The still photo was empty.");
  }
  if (!isAllowedTemplateVideoUrl(fields.video_url)) {
    throw new Error("The template motion video URL is not a public Hugging Face clip.");
  }
  const hasPropImage = typeof fields.prop_image_base64 === "string" && fields.prop_image_base64.length > 0;
  assertMixMarks(fields, { hasPropImage });
  const size = targetSize(fields);
  const negative = String(fields.negative_prompt || fields.negative || "").trim();
  const personCount = normalizePoints(fields.positive_points).length;
  const prompt = mixPrompt(fields.prompt, hasPropImage, personCount);
  let image_base64 = fields.image_base64;
  if (hasPropImage) {
    image_base64 = compositeReferenceBase64(fields.image_base64, fields.prop_image_base64) || fields.image_base64;
  }
  const mask = buildMaskPointFields({
    ...fields,
    width: size.width,
    height: size.height,
  });
  if (!mask.points_store) {
    throw new Error("Tap the person to replace (green) before Generate.");
  }
  const cfg = Number(fields.cfg ?? fields.guidance);
  const steps = Number(fields.steps);
  const input = {
    image_base64,
    video_url: fields.video_url,
    prompt: prompt.slice(0, 2000),
    negative_prompt: (negative || RUNPOD_DEFAULTS.negative_prompt).slice(0, 1000),
    seed: normalizeSeed(fields.seed),
    ...size,
    fps: RUNPOD_DEFAULTS.fps,
    cfg: Number.isFinite(cfg) && cfg > 0 ? cfg : RUNPOD_DEFAULTS.cfg,
    steps: Number.isFinite(steps) && steps > 0 ? Math.min(30, Math.floor(steps)) : RUNPOD_DEFAULTS.steps,
    // Mix is always replace. Positive SAM points cover the person and any prop.
    mode: "replace",
    ...mask,
  };
  if (hasPropImage) input.prop_image_base64 = fields.prop_image_base64;
  return input;
}

function pickMessage(json, text) {
  if (!json || typeof json !== "object") {
    return typeof text === "string" ? text : "";
  }
  if (typeof json.error === "string") return json.error;
  if (json.error && typeof json.error.message === "string") return json.error.message;
  if (typeof json.output === "object" && json.output && typeof json.output.error === "string") return json.output.error;
  if (typeof json.message === "string") return json.message;
  return typeof text === "string" && !text.trim().startsWith("{") ? text : "";
}

export function explainRunpodFailure({ httpStatus, json, text } = {}) {
  const statusName = String(json?.status || "").toUpperCase();
  let message = pickMessage(json, text).replace(/\s+/g, " ").trim();
  message = message.replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
  const blob = `${httpStatus || ""} ${statusName} ${message}`;
  if (httpStatus === 402 || CREDIT_RE.test(blob)) {
    return "Runpod is out of credits. Add credits on the Runpod account, then try Generate again.";
  }
  if (httpStatus === 401 || httpStatus === 403 || AUTH_RE.test(blob)) {
    return "Runpod rejected the API key. Check RUNPOD_API_KEY on this site (Vercel Production and Preview, or Netlify swapr-casey), then redeploy.";
  }
  if (statusName === "TIMED_OUT") {
    return "Runpod timed out. The first Generate after the worker has been idle can take several minutes. Wait a minute and try once.";
  }
  if (statusName === "CANCELLED") return "Runpod cancelled the job before it finished. Try Generate again.";
  if (/비디오|no video|video not found|could not find/i.test(message)) {
    return "Runpod finished without a video.";
  }
  if (message) return `Runpod failed: ${message}`.slice(0, 500);
  if (httpStatus) return `Runpod failed (HTTP ${httpStatus}).`;
  return "Runpod failed.";
}

function looksLikeBase64(value) {
  if (typeof value !== "string") return false;
  const compact = value.trim().replace(/^data:[^;]+;base64,/i, "").replace(/\s+/g, "");
  return compact.length >= 32 && /^[A-Za-z0-9+/]+=*$/.test(compact);
}

export function extractRunpodVideoBase64(output) {
  const found = [];
  const visit = (node, depth) => {
    if (found.length || depth > 8 || node == null) return;
    if (typeof node === "string") {
      if (looksLikeBase64(node)) found.push(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    if (typeof node !== "object") return;
    for (const key of ["video", "base64", "data", "gifs"]) {
      if (key in node) visit(node[key], depth + 1);
      if (found.length) return;
    }
    for (const value of Object.values(node)) visit(value, depth + 1);
  };
  visit(output, 0);
  return found[0] || null;
}

export function videoContentType(bytes) {
  if (!bytes || bytes.length < 12) return "video/mp4";
  const head = Buffer.from(bytes.subarray(0, Math.min(bytes.length, 64)));
  if (head.includes(Buffer.from("ftyp"))) return "video/mp4";
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return "video/webm";
  return "video/mp4";
}

export function isVideoBytes(bytes) {
  if (!bytes || bytes.length < 16) return false;
  const head = Buffer.from(bytes.subarray(0, Math.min(bytes.length, 64)));
  if (head.includes(Buffer.from("ftyp"))) return true;
  return head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3;
}

export function decodeVideoBase64(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  let raw = value.trim().replace(/^data:[^;]+;base64,/i, "").replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]+=*$/.test(raw)) return null;
  const bytes = Buffer.from(raw, "base64");
  if (!isVideoBytes(bytes)) return null;
  return bytes;
}

function isTerminalFailure(status) {
  const name = String(status || "").toUpperCase();
  return name === "FAILED" || name === "CANCELLED" || name === "TIMED_OUT" || name === "ERROR";
}

export function isJobId(value) {
  return /^[A-Za-z0-9_-]{6,96}$/.test(String(value || ""));
}

function statusError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export async function stillToBase64(photo) {
  if (!photo || typeof photo.arrayBuffer !== "function") {
    throw statusError("Upload a still photo of the person who should replace the marked person.", 400);
  }
  const buf = Buffer.from(await photo.arrayBuffer());
  if (!buf.length) throw statusError("The still photo was empty.", 400);
  if (buf.length > MAX_STILL_BYTES) {
    throw statusError("That still is too large. Choose a smaller photo and try again.", 400);
  }
  return buf.toString("base64");
}

/**
 * Map a Runpod /status body to the phone job document.
 * Never includes the mp4 bytes or the API key.
 */
export function describeRunpodJob(jobId, body) {
  const status = String(body?.status || "").toUpperCase();
  if (status === "COMPLETED") {
    const encoded = extractRunpodVideoBase64(body?.output ?? body);
    if (!decodeVideoBase64(encoded)) {
      return {
        job_id: jobId,
        phase: "error",
        error: explainRunpodFailure({
          json: {
            status,
            error: body?.output?.error || body?.error || "Runpod finished without a video.",
          },
        }),
      };
    }
    const url = `/api/result?id=${encodeURIComponent(jobId)}`;
    return {
      job_id: jobId,
      phase: "done",
      video: url,
      url,
      status: "Done.",
      session_id: null,
      state: null,
    };
  }
  if (isTerminalFailure(status)) {
    return { job_id: jobId, phase: "error", error: explainRunpodFailure({ json: body }) };
  }
  if (status === "IN_PROGRESS" || status === "RUNNING") {
    return { job_id: jobId, phase: "running" };
  }
  if (status === "IN_QUEUE" || status === "QUEUED") {
    return { job_id: jobId, phase: "queued" };
  }
  return { job_id: jobId, phase: "error", error: "Runpod did not return a job status." };
}

async function fetchWithTimeout(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function runpodRequest(url, { apiKey, fetchImpl, method = "GET", body, timeoutMs }) {
  let response;
  try {
    response = await fetchWithTimeout(
      fetchImpl,
      url,
      {
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
          ...(body ? { "content-type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      },
      timeoutMs
    );
  } catch (error) {
    const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
    throw new Error(
      timedOut
        ? "Runpod did not respond in time. The worker may be starting. Wait a minute and try Generate once."
        : "Could not reach Runpod. Try Generate again."
    );
  }
  const text = typeof response.text === "function" ? await response.text() : "";
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!response.ok) {
    const error = new Error(explainRunpodFailure({ httpStatus: response.status, json, text }));
    error.statusCode = response.status;
    throw error;
  }
  return { response, text, json };
}

function missingRunpodError() {
  return new Error("Generate uses Runpod, but RUNPOD_API_KEY or RUNPOD_ENDPOINT_ID is missing.");
}

async function submitToAccount(account, input, deps, tag) {
  const fetchImpl = deps.fetch || fetch;
  const timeoutMs = Math.min(30000, deps.timeoutMs ?? 30000);
  const submitted = await runpodRequest(`${account.endpoint}/run`, {
    apiKey: account.apiKey,
    fetchImpl,
    method: "POST",
    body: { input },
    timeoutMs,
  });
  const first = submitted.json || {};
  if (isTerminalFailure(first.status)) {
    const error = new Error(explainRunpodFailure({ httpStatus: submitted.response.status, json: first, text: submitted.text }));
    error.statusCode = submitted.response.status;
    if (isRunpodCreditError(error) || CREDIT_RE.test(`${first.status || ""} ${submitted.text || ""}`)) error.credit = true;
    throw error;
  }
  if (!isJobId(first.id)) {
    throw new Error(
      explainRunpodFailure({
        httpStatus: submitted.response.status,
        json: first,
        text: submitted.text || "Runpod did not return a job id.",
      })
    );
  }
  return { ...first, id: tagRunpodJobId(account.slot, first.id, tag) };
}

export async function startRunpodJob(env, input, deps = {}) {
  const accounts = listRunpodAccounts(env);
  if (!accounts.length) throw missingRunpodError();
  if (accounts.length === 1) return submitToAccount(accounts[0], input, deps, false);
  const ranked = await rankAccountsByBalance(accounts, deps);
  try {
    return await submitToAccount(ranked[0], input, deps, true);
  } catch (error) {
    if (!ranked[1] || !isRunpodCreditError(error)) throw error;
    return submitToAccount(ranked[1], input, deps, true);
  }
}

export async function fetchRunpodJob(env, jobId, deps = {}) {
  const resolved = resolveRunpodAccount(env, jobId);
  if (!resolved.account) {
    const error = resolved.missingSlot
      ? new Error(`That job was started on Runpod ${resolved.missingSlot}, which is not configured on this site.`)
      : missingRunpodError();
    error.statusCode = resolved.missingSlot ? 409 : 500;
    throw error;
  }
  const fetchImpl = deps.fetch || fetch;
  const polled = await runpodRequest(`${resolved.account.endpoint}/status/${encodeURIComponent(resolved.rawId)}`, {
    apiKey: resolved.account.apiKey,
    fetchImpl,
    timeoutMs: deps.timeoutMs ?? 30000,
  });
  return { body: polled.json || {}, httpStatus: polled.response.status, text: polled.text };
}

export async function submitAndWait(env, input, deps = {}) {
  const timeoutMs = deps.timeoutMs ?? 14 * 60 * 1000;
  const intervalMs = deps.intervalMs ?? 5000;
  const sleep = deps.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const started = Date.now();
  const first = await startRunpodJob(env, input, { ...deps, timeoutMs });
  if (String(first.status || "").toUpperCase() === "COMPLETED") return first;

  while (Date.now() - started < timeoutMs) {
    await sleep(intervalMs);
    const polled = await fetchRunpodJob(env, first.id, deps);
    const body = polled.body || {};
    const status = String(body.status || "").toUpperCase();
    if (status === "COMPLETED") return body;
    if (isTerminalFailure(status)) {
      throw new Error(explainRunpodFailure({ httpStatus: polled.httpStatus, json: body, text: polled.text }));
    }
  }
  throw new Error(
    "Runpod did not finish within 14 minutes. The first Generate after the worker has been idle can take several minutes. Wait a minute and try once."
  );
}

/**
 * Vercel has no background worker. POST /run and return the Runpod job id.
 * The phone polls /api/job, which calls /status.
 */
export async function submitGenerateOnRunpod({ payload, photo, propPhoto, env, fetch: fetchImpl } = {}) {
  let input;
  try {
    const image_base64 = await stillToBase64(photo);
    const prop_image_base64 = propPhoto ? await stillToBase64(propPhoto) : undefined;
    const video_url = await resolveMotionVideoUrl(payload || {}, { fetch: fetchImpl || fetch });
    input = buildRunpodInput({ ...(payload || {}), video_url, image_base64, prop_image_base64 });
  } catch (error) {
    if (Number.isInteger(error?.statusCode)) throw error;
    throw statusError(error instanceof Error ? error.message : String(error), 400);
  }
  const started = await startRunpodJob(env, input, { fetch: fetchImpl || fetch });
  return { job_id: started.id, phase: "queued" };
}

export async function loadRunpodResultVideo(env, jobId, deps = {}) {
  const polled = await fetchRunpodJob(env, jobId, deps);
  const described = describeRunpodJob(jobId, polled.body);
  if (described.phase !== "done") {
    const error = new Error(described.phase === "error" ? described.error : "Result is not ready");
    error.statusCode = described.phase === "error" ? 502 : 404;
    throw error;
  }
  const encoded = extractRunpodVideoBase64(polled.body?.output ?? polled.body);
  const bytes = decodeVideoBase64(encoded);
  if (!bytes) {
    throw statusError("Runpod finished without a video.", 502);
  }
  return { bytes, contentType: videoContentType(bytes) };
}

export async function runRunpodGenerate(spec, deps = {}) {
  const env = deps.env || process.env;
  if (!spec?.image_base64) throw new Error("The still photo was empty.");
  const fetchImpl = deps.fetch || fetch;
  const video_url = spec.video_url || (await resolveMotionVideoUrl(spec.payload || {}, { fetch: fetchImpl }));
  const input = buildRunpodInput({
    ...(spec.payload || {}),
    video_url,
    image_base64: spec.image_base64,
    prop_image_base64: spec.prop_image_base64,
  });
  const completed = await submitAndWait(env, input, deps);
  const encoded = extractRunpodVideoBase64(completed?.output ?? completed);
  const bytes = decodeVideoBase64(encoded);
  if (!bytes) {
    throw new Error(
      explainRunpodFailure({
        json: completed?.output?.error ? { error: completed.output.error, status: completed.status } : { status: completed?.status, error: "Runpod finished without a video." },
      })
    );
  }
  if (!deps.store || typeof deps.store.setBytes !== "function") {
    throw new Error("Cannot store the result video.");
  }
  await deps.store.setBytes(resultVideoKey(spec.job_id), bytes, { contentType: videoContentType(bytes) });
  const url = `/api/result?id=${encodeURIComponent(spec.job_id)}`;
  return {
    video: url,
    url,
    status: "Done.",
    session_id: null,
    state: null,
  };
}
