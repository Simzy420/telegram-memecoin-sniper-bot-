/**
 * Runpod account helpers for the phone UI: live balance and "Stop GPU".
 * API keys stay server-side. Nothing here returns a key.
 * Account 2 is used only when RUNPOD_API_KEY_2 is set; otherwise this matches
 * the single-account behavior.
 */
import { cachedRunpodBalance, listRunpodAccounts, parseRunpodJobId } from "./runpod.js";

const REST_URL = "https://rest.runpod.io/v1";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function missingKey() {
  const error = new Error("RUNPOD_API_KEY is not set on this site.");
  error.statusCode = 500;
  throw error;
}

async function timed(fetchImpl, url, init = {}, ms = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text.slice(0, 300) };
  }
}

export async function fetchRunpodBalance(env = process.env, deps = {}) {
  const accounts = listRunpodAccounts(env);
  if (!accounts.length) missingKey();
  const rows = [];
  const failures = [];
  for (const account of accounts) {
    try {
      const info = await cachedRunpodBalance(account.apiKey, deps);
      rows.push({
        label: account.label,
        balance: info.balance,
        spendPerHour: info.spendPerHour,
        at: info.at,
      });
    } catch (error) {
      failures.push(error);
      rows.push({ label: account.label, balance: null, spendPerHour: null, at: null });
    }
  }
  if (failures.length === accounts.length) throw failures[0];
  const primary =
    rows.find((row) => row.label === "Runpod 1" && typeof row.balance === "number") ||
    rows.find((row) => typeof row.balance === "number") ||
    rows[0];
  return {
    balance: primary.balance,
    spendPerHour: primary.spendPerHour,
    at: primary.at || new Date().toISOString(),
    accounts: rows.map(({ label, balance, spendPerHour }) => ({ label, balance, spendPerHour })),
  };
}

async function health(endpoint, key, fetchImpl) {
  const response = await timed(fetchImpl, `https://api.runpod.ai/v2/${endpoint}/health`, {
    headers: { authorization: `Bearer ${key}` },
  });
  return response.ok ? readJson(response) : { error: `health HTTP ${response.status}` };
}

async function patchEndpoint(endpoint, key, fetchImpl, patch) {
  const response = await timed(fetchImpl, `${REST_URL}/endpoints/${endpoint}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify(patch),
  });
  const body = await readJson(response);
  if (!response.ok) throw new Error(`update endpoint HTTP ${response.status}: ${JSON.stringify(body).slice(0, 200)}`);
  return body;
}

function shouldCancelJob(rawJobId, tagged) {
  if (!rawJobId || !/^[A-Za-z0-9_-]{6,96}$/.test(rawJobId)) return false;
  if (tagged) return true;
  return !UUID_RE.test(rawJobId);
}

/**
 * Stop background billing on the Wan Animate endpoint for one account:
 * cancel the in-flight job (if it belongs to this account), purge the queue,
 * force workersMin=0, and briefly set workersMax=0 so running/idle workers
 * are released, then restore workersMax so the next Generate can start.
 */
async function stopOneAccount(account, { rawJobId, tagged, restoreDelayMs, fetchImpl, sleep }) {
  const steps = [];
  const endpoint = account.endpointId;
  const key = account.apiKey;
  const base = `https://api.runpod.ai/v2/${endpoint}`;
  const auth = { authorization: `Bearer ${key}` };

  if (shouldCancelJob(rawJobId, tagged)) {
    const r = await timed(fetchImpl, `${base}/cancel/${encodeURIComponent(rawJobId)}`, { method: "POST", headers: auth }).catch((e) => ({ ok: false, status: e.message }));
    steps.push(`cancel ${rawJobId}: ${r.ok ? "ok" : `failed (${r.status})`}`);
  }
  const purge = await timed(fetchImpl, `${base}/purge-queue`, { method: "POST", headers: auth }).catch((e) => ({ ok: false, status: e.message }));
  const purgeBody = purge.ok ? await readJson(purge) : {};
  steps.push(`purge queue: ${purge.ok ? `ok (${purgeBody.removed ?? 0} removed)` : `failed (${purge.status})`}`);

  let originalMax = null;
  try {
    const r = await timed(fetchImpl, `${REST_URL}/endpoints/${endpoint}`, { headers: auth });
    const ep = r.ok ? await readJson(r) : {};
    originalMax = Number.isFinite(Number(ep.workersMax)) && Number(ep.workersMax) > 0 ? Number(ep.workersMax) : 1;
    await patchEndpoint(endpoint, key, fetchImpl, { workersMin: 0, workersMax: 0 });
    steps.push(`workersMin=0, workersMax 0 (was ${originalMax}) to release workers`);
    await sleep(restoreDelayMs);
    await patchEndpoint(endpoint, key, fetchImpl, { workersMin: 0, workersMax: originalMax });
    steps.push(`workersMax restored to ${originalMax}, workersMin stays 0`);
  } catch (error) {
    steps.push(`scale down: ${error instanceof Error ? error.message : String(error)}`);
    if (originalMax) {
      await patchEndpoint(endpoint, key, fetchImpl, { workersMin: 0, workersMax: originalMax }).catch(() => {});
    }
  }
  const after = await health(endpoint, key, fetchImpl).catch((e) => ({ error: e.message }));
  return { endpoint, steps, health: after };
}

export async function stopRunpodEndpoint(env = process.env, { jobId = "", restoreDelayMs = 6000 } = {}, deps = {}) {
  const fetchImpl = deps.fetch || fetch;
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const accounts = listRunpodAccounts(env);
  if (!accounts.length) missingKey();
  const parsed = parseRunpodJobId(jobId);
  if (parsed.tagged && !accounts.some((account) => account.slot === parsed.slot)) {
    const error = new Error(`That job was started on Runpod ${parsed.slot}, which is not configured on this site.`);
    error.statusCode = 409;
    throw error;
  }
  const ownsJob = (account) => (parsed.tagged ? account.slot === parsed.slot : account === accounts[0]);
  const results = await Promise.all(
    accounts.map((account) =>
      stopOneAccount(account, {
        rawJobId: ownsJob(account) ? parsed.rawId : "",
        tagged: parsed.tagged && ownsJob(account),
        restoreDelayMs,
        fetchImpl,
        sleep,
      })
    )
  );
  const ownerIndex = Math.max(0, accounts.findIndex((account) => ownsJob(account)));
  const steps =
    accounts.length === 1
      ? results[0].steps
      : results.flatMap((result, index) => result.steps.map((step) => `${accounts[index].label}: ${step}`));
  return {
    endpoint: results[ownerIndex].endpoint,
    steps,
    health: results[ownerIndex].health,
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" },
  });
}

export async function handleBalanceRequest(request, deps = {}) {
  try {
    return json(await fetchRunpodBalance(deps.env || process.env, deps));
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, error?.statusCode || 502);
  }
}

export async function handleStopRequest(request, deps = {}) {
  if ((request?.method || "POST") !== "POST") return json({ error: "Method not allowed" }, 405);
  let jobId = "";
  try {
    const body = await request.json();
    jobId = typeof body?.job_id === "string" ? body.job_id : "";
  } catch {
    jobId = "";
  }
  try {
    return json(await stopRunpodEndpoint(deps.env || process.env, { jobId }, deps));
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, error?.statusCode || 502);
  }
}
