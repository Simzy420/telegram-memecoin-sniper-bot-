import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handleBalanceRequest, handleStopRequest } from "../server/runpodAdmin.js";
import { fetchRunpodJob, isJobId, listRunpodAccounts, runpodConfigured, startRunpodJob } from "../server/runpod.js";
import { handleRunpodJobRequest } from "../server/runpodRoutes.js";

const TWO = {
  RUNPOD_API_KEY: "key-1",
  RUNPOD_ENDPOINT_ID: "zrmwpir4qzs66s",
  RUNPOD_ENDPOINT_URL: "https://api.runpod.ai/v2/zrmwpir4qzs66s",
  RUNPOD_API_KEY_2: "key-2",
  RUNPOD_ENDPOINT_ID_2: "3qu6rstqmkum81",
  RUNPOD_ENDPOINT_URL_2: "https://api.runpod.ai/v2/3qu6rstqmkum81",
};

function jsonRes(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

function authOf(init) {
  return init?.headers?.Authorization || init?.headers?.authorization || "";
}

function keyOf(init) {
  return authOf(init).replace(/^Bearer\s+/i, "");
}

function graphqlBalance(balance, spendPerHour = 0) {
  return jsonRes({ data: { myself: { clientBalance: balance, currentSpendPerHr: spendPerHour } } });
}

describe("two Runpod accounts", () => {
  it("pairs each key with its own endpoint and skips account 2 when its key is missing", () => {
    const accounts = listRunpodAccounts(TWO);
    assert.deepEqual(
      accounts.map((account) => ({ slot: account.slot, endpointId: account.endpointId, endpoint: account.endpoint })),
      [
        {
          slot: "1",
          endpointId: "zrmwpir4qzs66s",
          endpoint: "https://api.runpod.ai/v2/zrmwpir4qzs66s",
        },
        {
          slot: "2",
          endpointId: "3qu6rstqmkum81",
          endpoint: "https://api.runpod.ai/v2/3qu6rstqmkum81",
        },
      ]
    );
    assert.equal(accounts[0].apiKey, "key-1");
    assert.equal(accounts[1].apiKey, "key-2");
    const one = listRunpodAccounts({ RUNPOD_API_KEY: "only-1", RUNPOD_ENDPOINT_ID_2: "3qu6rstqmkum81" });
    assert.equal(one.length, 1);
    assert.equal(one[0].slot, "1");
    assert.equal(one[0].endpointId, "zrmwpir4qzs66s");
    const fallback = listRunpodAccounts({ RUNPOD_API_KEY_2: "only-2" });
    assert.equal(fallback.length, 1);
    assert.equal(fallback[0].endpointId, "3qu6rstqmkum81");
    assert.equal(fallback[0].endpoint, "https://api.runpod.ai/v2/3qu6rstqmkum81");
    const crossed = listRunpodAccounts({
      RUNPOD_API_KEY_2: "only-2",
      RUNPOD_ENDPOINT_ID_2: "3qu6rstqmkum81",
      RUNPOD_ENDPOINT_URL_2: "https://api.runpod.ai/v2/zrmwpir4qzs66s",
    });
    assert.equal(crossed[0].endpoint, "https://api.runpod.ai/v2/3qu6rstqmkum81");
    const evil = listRunpodAccounts({
      RUNPOD_API_KEY_2: "only-2",
      RUNPOD_ENDPOINT_ID_2: "3qu6rstqmkum81",
      RUNPOD_ENDPOINT_URL_2: "https://evil.example/v2/3qu6rstqmkum81",
    });
    assert.equal(evil[0].endpoint, "https://api.runpod.ai/v2/3qu6rstqmkum81");
    assert.equal(runpodConfigured({}), false);
    assert.equal(runpodConfigured({ RUNPOD_API_KEY_2: "only-2" }), true);
  });

  it("keeps today's single-account submit: no balance call and the raw job id", async () => {
    const calls = [];
    const started = await startRunpodJob(
      { RUNPOD_API_KEY: "secret-key", RUNPOD_ENDPOINT_ID: "zrmwpir4qzs66s" },
      { image_base64: "abc" },
      {
        cache: new Map(),
        fetch: async (url, init) => {
          calls.push({ url, auth: authOf(init) });
          return jsonRes({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", status: "IN_QUEUE" });
        },
      }
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.runpod.ai/v2/zrmwpir4qzs66s/run");
    assert.equal(calls[0].auth, "Bearer secret-key");
    assert.equal(started.id, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    assert.equal(isJobId(started.id), true);
  });

  it("submits to the higher balance and tags the job with that account", async () => {
    const calls = [];
    const started = await startRunpodJob(TWO, { image_base64: "abc" }, {
      cache: new Map(),
      fetch: async (url, init) => {
        calls.push({ url, auth: authOf(init), body: init?.body });
        if (String(url).includes("graphql")) {
          assert.match(JSON.parse(init.body).query, /clientBalance/);
          return graphqlBalance(keyOf(init) === "key-2" ? 9.5 : 1.25, 0.2);
        }
        assert.match(url, /\/run$/);
        const id = url.includes("3qu6rstqmkum81") ? "jobtwo1" : "jobone1";
        return jsonRes({ id, status: "IN_QUEUE" });
      },
    });
    assert.equal(started.id, "rp2_jobtwo1");
    assert.equal(isJobId(started.id), true);
    const runs = calls.filter((call) => call.url.endsWith("/run"));
    assert.equal(runs.length, 1);
    assert.equal(runs[0].url, "https://api.runpod.ai/v2/3qu6rstqmkum81/run");
    assert.equal(runs[0].auth, "Bearer key-2");
    const graphs = calls.filter((call) => call.url.includes("graphql"));
    assert.deepEqual(graphs.map((call) => keyOf({ headers: { authorization: call.auth } })).sort(), ["key-1", "key-2"]);
  });

  it("prefers account 1 when the balances are equal", async () => {
    const started = await startRunpodJob(TWO, { image_base64: "abc" }, {
      cache: new Map(),
      fetch: async (url, init) => {
        if (String(url).includes("graphql")) return graphqlBalance(4);
        assert.equal(url, "https://api.runpod.ai/v2/zrmwpir4qzs66s/run");
        assert.equal(authOf(init), "Bearer key-1");
        return jsonRes({ id: "tiedjob1", status: "IN_QUEUE" });
      },
    });
    assert.equal(started.id, "rp1_tiedjob1");
  });

  it("retries once on the other account after a 402 or an insufficient-balance error", async () => {
    const runUrls = [];
    const started = await startRunpodJob(TWO, { image_base64: "abc" }, {
      cache: new Map(),
      fetch: async (url, init) => {
        if (String(url).includes("graphql")) return graphqlBalance(keyOf(init) === "key-2" ? 20 : 0.5);
        runUrls.push({ url, auth: authOf(init) });
        if (url.includes("3qu6rstqmkum81")) return jsonRes({ error: "insufficient balance" }, 402);
        return jsonRes({ id: "savedjob", status: "IN_QUEUE" });
      },
    });
    assert.deepEqual(
      runUrls.map((call) => call.url),
      [
        "https://api.runpod.ai/v2/3qu6rstqmkum81/run",
        "https://api.runpod.ai/v2/zrmwpir4qzs66s/run",
      ]
    );
    assert.equal(runUrls[0].auth, "Bearer key-2");
    assert.equal(runUrls[1].auth, "Bearer key-1");
    assert.equal(started.id, "rp1_savedjob");

    const failedRuns = [];
    const recovered = await startRunpodJob(TWO, { image_base64: "abc" }, {
      cache: new Map(),
      fetch: async (url, init) => {
        if (String(url).includes("graphql")) return graphqlBalance(keyOf(init) === "key-1" ? 12 : 1);
        failedRuns.push(url);
        if (failedRuns.length === 1) {
          return jsonRes({ id: "deadjob1", status: "FAILED", error: "Your account balance is too low" });
        }
        return jsonRes({ id: "secondok", status: "IN_QUEUE" });
      },
    });
    assert.equal(failedRuns.length, 2);
    assert.match(failedRuns[0], /zrmwpir4qzs66s\/run$/);
    assert.match(failedRuns[1], /3qu6rstqmkum81\/run$/);
    assert.equal(recovered.id, "rp2_secondok");
  });

  it("does not retry a non-credit failure, and stops after the other account also rejects", async () => {
    const runs = [];
    await assert.rejects(
      () =>
        startRunpodJob(TWO, { image_base64: "abc" }, {
          cache: new Map(),
          fetch: async (url, init) => {
            if (String(url).includes("graphql")) return graphqlBalance(keyOf(init) === "key-2" ? 5 : 1);
            runs.push(url);
            return jsonRes({ error: "worker exploded" }, 500);
          },
        }),
      /worker exploded/
    );
    assert.equal(runs.length, 1);
    assert.match(runs[0], /3qu6rstqmkum81/);

    const both = [];
    await assert.rejects(
      () =>
        startRunpodJob(TWO, { image_base64: "abc" }, {
          cache: new Map(),
          fetch: async (url) => {
            if (String(url).includes("graphql")) return graphqlBalance(String(url).includes("unused") ? 0 : 3);
            both.push(url);
            return jsonRes({ error: "insufficient credit" }, 402);
          },
        }),
      /out of credits/
    );
    assert.equal(both.length, 2);
  });

  it("reuses a balance for about 30 seconds", async () => {
    const cache = new Map();
    let now = 1_000;
    let graphql = 0;
    const fetchImpl = async (url, init) => {
      if (String(url).includes("graphql")) {
        graphql += 1;
        return graphqlBalance(keyOf(init) === "key-2" ? 8 : 1);
      }
      const id = url.includes("3qu6rstqmkum81") ? "cachedtwo" : "cachedone";
      return jsonRes({ id, status: "IN_QUEUE" });
    };
    const deps = { fetch: fetchImpl, cache, now: () => now };
    await startRunpodJob(TWO, { image_base64: "abc" }, deps);
    await startRunpodJob(TWO, { image_base64: "abc" }, deps);
    assert.equal(graphql, 2);
    now += 30_000;
    await startRunpodJob(TWO, { image_base64: "abc" }, deps);
    assert.equal(graphql, 4);
  });

  it("polls and plays status on the account encoded in the job id", async () => {
    const calls = [];
    const polled = await fetchRunpodJob(TWO, "rp2_job-from-two", {
      fetch: async (url, init) => {
        calls.push({ url, auth: authOf(init) });
        return jsonRes({ id: "job-from-two", status: "IN_PROGRESS" });
      },
    });
    assert.equal(calls[0].url, "https://api.runpod.ai/v2/3qu6rstqmkum81/status/job-from-two");
    assert.equal(calls[0].auth, "Bearer key-2");
    assert.equal(polled.body.status, "IN_PROGRESS");

    let called = false;
    await assert.rejects(
      () =>
        fetchRunpodJob({ RUNPOD_API_KEY: "key-1", RUNPOD_ENDPOINT_ID: "zrmwpir4qzs66s" }, "rp2_job-from-two", {
          fetch: async () => {
            called = true;
            return jsonRes({});
          },
        }),
      /Runpod 2/
    );
    assert.equal(called, false);

    const response = await handleRunpodJobRequest(new Request("https://mix.example/api/job?id=rp1_job-from-one"), {
      env: TWO,
      fetch: async (url, init) => {
        assert.equal(url, "https://api.runpod.ai/v2/zrmwpir4qzs66s/status/job-from-one");
        assert.equal(init.headers.Authorization, "Bearer key-1");
        return jsonRes({ id: "job-from-one", status: "IN_QUEUE" });
      },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.job_id, "rp1_job-from-one");
    assert.equal(body.phase, "queued");
    assert.equal(JSON.stringify(body).includes("key-1"), false);
  });

  it("returns both balances and keeps the original balance fields", async () => {
    const response = await handleBalanceRequest(new Request("https://mix.example/api/balance"), {
      env: TWO,
      cache: new Map(),
      fetch: async (url, init) => {
        assert.match(url, /api\.runpod\.io\/graphql/);
        assert.match(JSON.parse(init.body).query, /myself\s*\{\s*clientBalance/);
        if (keyOf(init) === "key-1") return graphqlBalance(2.5, 0.12);
        if (keyOf(init) === "key-2") return graphqlBalance(0.4, 0);
        throw new Error(`unexpected key ${keyOf(init)}`);
      },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.balance, 2.5);
    assert.equal(body.spendPerHour, 0.12);
    assert.equal(typeof body.at, "string");
    assert.deepEqual(body.accounts, [
      { label: "Runpod 1", balance: 2.5, spendPerHour: 0.12 },
      { label: "Runpod 2", balance: 0.4, spendPerHour: 0 },
    ]);
    assert.equal(JSON.stringify(body).includes("key-"), false);

    const single = await handleBalanceRequest(new Request("https://mix.example/api/balance"), {
      env: { RUNPOD_API_KEY: "secret-key", RUNPOD_ENDPOINT_ID: "zrmwpir4qzs66s" },
      cache: new Map(),
      fetch: async () => graphqlBalance(4.2, 1),
    });
    const one = await single.json();
    assert.equal(one.balance, 4.2);
    assert.equal(one.spendPerHour, 1);
    assert.deepEqual(one.accounts, [{ label: "Runpod 1", balance: 4.2, spendPerHour: 1 }]);

    const partial = await handleBalanceRequest(new Request("https://mix.example/api/balance"), {
      env: TWO,
      cache: new Map(),
      fetch: async (_url, init) => {
        if (keyOf(init) === "key-2") return jsonRes({ error: "nope" }, 500);
        return graphqlBalance(3, 0);
      },
    });
    assert.equal(partial.status, 200);
    const mixed = await partial.json();
    assert.equal(mixed.balance, 3);
    assert.equal(mixed.accounts[1].balance, null);
    assert.equal(mixed.accounts[1].label, "Runpod 2");

    const missing = await handleBalanceRequest(new Request("https://mix.example/api/balance"), {
      env: {},
      fetch: async () => {
        throw new Error("should not fetch");
      },
    });
    assert.equal(missing.status, 500);
    assert.match((await missing.json()).error, /RUNPOD_API_KEY/);
  });

  it("cancels and scales the account encoded on the job id", async () => {
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      calls.push({ url, method: init.method || "GET", auth: authOf(init) });
      if (url.includes("/cancel/") || url.includes("/purge-queue")) {
        return jsonRes(url.includes("purge") ? { removed: 1 } : {});
      }
      if (url.includes("rest.runpod.io") && (init.method || "GET") === "GET") return jsonRes({ workersMax: 2 });
      if (url.includes("rest.runpod.io") && init.method === "PATCH") return jsonRes({ ok: true });
      if (url.includes("/health")) {
        return jsonRes({ workers: { running: 0, idle: 0 }, jobs: { inQueue: 0, inProgress: 0 } });
      }
      return jsonRes({ error: "unexpected" }, 500);
    };
    const response = await handleStopRequest(
      new Request("https://mix.example/api/stop", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ job_id: "rp2_job-from-two" }),
      }),
      { env: TWO, fetch: fetchImpl, sleep: async () => {}, restoreDelayMs: 0 }
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.endpoint, "3qu6rstqmkum81");
    const cancels = calls.filter((call) => call.url.includes("/cancel/"));
    assert.equal(cancels.length, 1);
    assert.equal(cancels[0].url, "https://api.runpod.ai/v2/3qu6rstqmkum81/cancel/job-from-two");
    assert.equal(cancels[0].auth, "Bearer key-2");
    const purges = calls.filter((call) => call.url.includes("/purge-queue"));
    assert.equal(purges.length, 2);
    assert.equal(purges.find((call) => call.url.includes("zrmwpir4qzs66s")).auth, "Bearer key-1");
    assert.equal(purges.find((call) => call.url.includes("3qu6rstqmkum81")).auth, "Bearer key-2");
    assert.match(body.steps.join(" "), /Runpod 2: cancel job-from-two/);
    assert.equal(JSON.stringify(body).includes("key-"), false);

    const singleCalls = [];
    const uuid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const single = await handleStopRequest(
      new Request("https://mix.example/api/stop", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ job_id: uuid }),
      }),
      {
        env: { RUNPOD_API_KEY: "secret-key", RUNPOD_ENDPOINT_ID: "zrmwpir4qzs66s" },
        fetch: async (url, init = {}) => {
          singleCalls.push({ url, method: init.method || "GET", auth: authOf(init) });
          if (url.includes("rest.runpod.io") && (init.method || "GET") === "GET") return jsonRes({ workersMax: 1 });
          if (url.includes("rest.runpod.io")) return jsonRes({});
          if (url.includes("/purge-queue")) return jsonRes({ removed: 0 });
          if (url.includes("/health")) return jsonRes({ workers: { running: 0, idle: 1 }, jobs: { inQueue: 0, inProgress: 0 } });
          return jsonRes({});
        },
        sleep: async () => {},
      }
    );
    assert.equal(single.status, 200);
    const singleBody = await single.json();
    assert.equal(singleBody.endpoint, "zrmwpir4qzs66s");
    assert.equal(singleCalls.some((call) => call.url.includes("/cancel/")), false);
    assert.equal(singleCalls.filter((call) => call.url.includes("/purge-queue")).length, 1);
    assert.equal(singleCalls[0].auth, "Bearer secret-key");
    assert.equal(singleBody.steps.some((step) => step.startsWith("Runpod")), false);
  });
});
