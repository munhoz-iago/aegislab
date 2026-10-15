// Restarts and pauses the local Compose PostgreSQL service, then checks that the
// running API reports the outage and recovers without its own restart.
// Local-only and disruptive: it requires AEGISLAB_DISRUPT_LOCAL_DB=1.
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.env.AEGISLAB_DISRUPT_LOCAL_DB !== '1') {
  throw new Error('Set AEGISLAB_DISRUPT_LOCAL_DB=1 to restart and pause the local Compose db service');
}

const root = fileURLToPath(new URL('..', import.meta.url));
const HEALTH_URLS = { direct: 'http://127.0.0.1:3001/api/health', proxied: 'http://127.0.0.1:5173/api/health' };
const POLL_MS = 250;
const RECOVERY_LIMIT_MS = 60_000;
const PAUSE_OBSERVE_MS = 6_000;
// Well-formed but never issued: forces one bounded session lookup in PostgreSQL.
const SYNTHETIC_COOKIE = `aegislab_session=${'A'.repeat(43)}`;

function compose(args) {
  const result = spawnSync('docker', ['compose', ...args], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`docker compose ${args[0]} failed with exit ${result.status}`);
  return result.stdout.trim();
}

function composeAsync(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['compose', ...args], { cwd: root, stdio: 'ignore' });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`docker compose ${args[0]} failed with exit ${code}`))));
  });
}

function apiContainer() {
  const id = compose(['ps', '-q', 'api']);
  const [startedAt, restartCount] = spawnSync('docker', ['inspect', '--format', '{{.State.StartedAt}} {{.RestartCount}}', id], { encoding: 'utf8' })
    .stdout.trim().split(' ');
  return { id: id.slice(0, 12), startedAt, restartCount: Number(restartCount) };
}

async function probe(url, init = {}) {
  const started = performance.now();
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(8_000) });
    await response.body?.cancel();
    return { status: response.status, ms: Math.round(performance.now() - started) };
  } catch {
    return { status: 'network_error', ms: Math.round(performance.now() - started) };
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls both health URLs until each returns 200 or the limit expires. */
async function waitForRecovery(since) {
  const statuses = {};
  const recoveredAt = {};
  while (performance.now() - since < RECOVERY_LIMIT_MS) {
    for (const [name, url] of Object.entries(HEALTH_URLS)) {
      if (recoveredAt[name] !== undefined) continue;
      const { status } = await probe(url);
      statuses[`${name}:${status}`] = (statuses[`${name}:${status}`] ?? 0) + 1;
      if (status === 200) recoveredAt[name] = Math.round(performance.now() - since);
    }
    if (Object.keys(HEALTH_URLS).every((name) => recoveredAt[name] !== undefined)) break;
    await sleep(POLL_MS);
  }
  return { recoveredAfterMs: recoveredAt, statuses };
}

function runAuthSmoke() {
  const result = spawnSync(process.execPath, ['scripts/smoke-api.mjs'], { cwd: root, encoding: 'utf8' });
  return result.status;
}

function apiLogEvents(sinceIso) {
  const logs = spawnSync('docker', ['compose', 'logs', '--no-log-prefix', '--since', sinceIso, 'api'], { cwd: root, encoding: 'utf8' }).stdout;
  const counts = {};
  for (const line of logs.split('\n')) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry.event === 'http_request') continue;
    const key = [entry.event, entry.pgCode, entry.errorName].filter(Boolean).join(':');
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

const startedIso = new Date().toISOString();
const before = apiContainer();
const baseline = { direct: await probe(HEALTH_URLS.direct), proxied: await probe(HEALTH_URLS.proxied) };
if (baseline.direct.status !== 200 || baseline.proxied.status !== 200) throw new Error('Stack is not healthy before the test');
const report = { before, baseline };

// 1. Restart: PostgreSQL terminates every pooled connection.
const restartStarted = performance.now();
let restartDone = false;
const restart = composeAsync(['restart', 'db']).finally(() => { restartDone = true; });
const duringRestart = {};
while (!restartDone) {
  const { status } = await probe(HEALTH_URLS.direct);
  duringRestart[status] = (duringRestart[status] ?? 0) + 1;
  await sleep(POLL_MS);
}
await restart;
const commandMs = Math.round(performance.now() - restartStarted);
// Recovery is timed from the moment the restart command returned.
report.restart = { commandMs, healthDuringRestart: duringRestart, ...(await waitForRecovery(performance.now())) };
report.restart.authSmokeExit = runAuthSmoke();

// 2. Pause: the TCP peer stays up but stops answering, so only timeouts end requests.
let paused = false;
try {
  compose(['pause', 'db']);
  paused = true;
  const pauseStarted = performance.now();
  const health = [];
  while (performance.now() - pauseStarted < PAUSE_OBSERVE_MS) {
    health.push(await probe(HEALTH_URLS.direct));
    await sleep(POLL_MS);
  }
  const sessionLookup = await probe('http://127.0.0.1:3001/api/auth/me', { headers: { cookie: SYNTHETIC_COOKIE } });
  report.pause = {
    healthStatuses: [...new Set(health.map((item) => item.status))],
    slowestHealthMs: Math.max(...health.map((item) => item.ms)),
    sessionLookup,
  };
} finally {
  if (paused) compose(['unpause', 'db']);
}
const unpauseStarted = performance.now();
Object.assign(report.pause, await waitForRecovery(unpauseStarted));
report.pause.authSmokeExit = runAuthSmoke();

report.after = apiContainer();
report.apiProcessKept = report.after.id === before.id && report.after.startedAt === before.startedAt && report.after.restartCount === before.restartCount;
report.apiLogEvents = apiLogEvents(startedIso);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

const recovered = (phase) => Object.keys(HEALTH_URLS).every((name) => phase.recoveredAfterMs[name] !== undefined);
const ok = report.apiProcessKept && recovered(report.restart) && recovered(report.pause) &&
  report.restart.authSmokeExit === 0 && report.pause.authSmokeExit === 0 &&
  report.pause.healthStatuses.includes(503) && !report.pause.healthStatuses.includes(200) &&
  typeof report.pause.sessionLookup.status === 'number' && report.pause.sessionLookup.status >= 500;
process.exitCode = ok ? 0 : 1;
