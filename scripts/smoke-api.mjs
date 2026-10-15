import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

const configuredUrl = process.env.AEGISLAB_WEB_URL ?? 'http://127.0.0.1:5173';
const parsedUrl = new URL(configuredUrl);
if (parsedUrl.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(parsedUrl.hostname) ||
    parsedUrl.pathname !== '/' || parsedUrl.search || parsedUrl.hash || parsedUrl.username || parsedUrl.password) {
  throw new Error('AEGISLAB_WEB_URL must be a local HTTP origin (127.0.0.1 or localhost)');
}
const origin = parsedUrl.origin;
const baseUrl = `${origin}/api`;
const credentials = {
  email: `smoke-${randomBytes(6).toString('hex')}@example.test`,
  password: randomBytes(24).toString('hex'),
};

const health = await fetch(`${baseUrl}/health`);
function assertRequestId(response) {
  assert.match(response.headers.get('x-request-id') ?? '', /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
}

function assertAuthStatus(response, expected) {
  if (response.status === 429) {
    throw new Error(`Rate limited by the shared local limiter; retry after ${response.headers.get('retry-after') ?? 'unknown'} s`);
  }
  assert.equal(response.status, expected);
  assertRequestId(response);
}

assertRequestId(health);
assert.equal(health.status, 200, 'Local API and PostgreSQL must be running');
assert.equal((await health.json()).database, 'connected');

async function post(path) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify(credentials),
  });
}

const registered = await post('/auth/register');
assertAuthStatus(registered, 201);
const registeredUser = (await registered.json()).user;
assert.ok(registeredUser?.id);
const firstCookie = registered.headers.get('set-cookie')?.split(';', 1)[0];
assert.ok(firstCookie?.startsWith('aegislab_session='));

const me = await fetch(`${baseUrl}/auth/me`, { headers: { cookie: firstCookie } });
assertRequestId(me);
assert.equal((await me.json()).user.id, registeredUser.id);
const dashboard = await fetch(`${baseUrl}/dashboard`, { headers: { cookie: firstCookie } });
assertRequestId(dashboard);
assert.equal(dashboard.status, 200);
assert.equal((await dashboard.json()).status, 'foundation');

const logout = await fetch(`${baseUrl}/auth/logout`, {
  method: 'POST',
  headers: { origin, cookie: firstCookie },
});
assertRequestId(logout);
assert.equal(logout.status, 204);
const denied = await fetch(`${baseUrl}/dashboard`, { headers: { cookie: firstCookie } });
assertRequestId(denied);
assert.equal(denied.status, 401, 'The old session must be revoked');

const loggedIn = await post('/auth/login');
assertAuthStatus(loggedIn, 200);
assert.equal((await loggedIn.json()).user.id, registeredUser.id);
const secondCookie = loggedIn.headers.get('set-cookie')?.split(';', 1)[0];
assert.ok(secondCookie?.startsWith('aegislab_session='));
const finalLogout = await fetch(`${baseUrl}/auth/logout`, {
  method: 'POST',
  headers: { origin: 'http://localhost:5173', cookie: secondCookie },
});
assertRequestId(finalLogout);
assert.equal(finalLogout.status, 204, 'localhost must be in the exact allowed origin list');
const finalMe = await fetch(`${baseUrl}/auth/me`, { headers: { cookie: secondCookie } });
assertRequestId(finalMe);
assert.equal(finalMe.status, 401);
process.stdout.write('Live API flow passed: register, session, dashboard, logout revocation, login, final logout.\n');
