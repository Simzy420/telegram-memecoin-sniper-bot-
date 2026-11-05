/**
 * Vercel serverless function — returns the agent's Virtuals compute balance.
 * Runs `acp compute status --json` server-side and returns the result.
 * Falls back to a static JSON file if acp is not available.
 */
export default async function handler(req: any, res: any) {
  // CORS — allow the command-center frontend
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  try {
    // Try to run acp compute status --json
    const { execSync } = require('child_process');
    const raw = execSync('acp compute status --json', {
      timeout: 10000,
      encoding: 'utf-8',
      cwd: '/tmp',
    });
    const d = JSON.parse(raw);
    res.status(200).json({
      limit: d.limit ?? 0,
      remaining: d.limitRemaining ?? d.limit ?? 0,
      totalUsage: d.usage ?? 0,
      updated: new Date().toISOString(),
    });
  } catch {
    // ACP not available on Vercel — return 502 so the widget falls through
    // to the static compute-balance.json file updated by the cron job.
    res.status(502).json({
      error: 'acp not available on this server',
      updated: new Date().toISOString(),
    });
  }
}
