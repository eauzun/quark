import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../src/server/api';

test('API exposes health, rejects cross-origin writes and protects task mutations', async () => {
  const api = createApi();
  const previous = process.env.APP_ORIGIN;
  process.env.APP_ORIGIN = 'https://quark.example';
  try {
    const health = await api.inject({ method: 'GET', url: '/health' });
    assert.equal(health.statusCode, 200); assert.equal(health.json().chainId, 10143);
    const forbidden = await api.inject({ method: 'POST', url: '/profile', headers: { origin: 'https://attacker.example' }, payload: { name: 'test' } });
    assert.equal(forbidden.statusCode, 403);
    const signedOut = await api.inject({ method: 'POST', url: '/tasks', headers: { origin: 'https://quark.example' }, payload: {} });
    assert.equal(signedOut.statusCode, 401);
    const roleChange = await api.inject({ method: 'POST', url: '/auth/role', headers: { origin: 'https://quark.example' }, payload: { role: 'employer' } });
    assert.equal(roleChange.statusCode, 401);
    const logout = await api.inject({ method: 'POST', url: '/auth/logout', headers: { origin: 'https://quark.example' }, payload: {} });
    assert.equal(logout.statusCode, 200);
    assert.match(String(logout.headers['set-cookie']), /HttpOnly; SameSite=Strict; Max-Age=0; Secure/);
  } finally {
    if (previous === undefined) delete process.env.APP_ORIGIN; else process.env.APP_ORIGIN = previous;
    await api.close();
  }
});
