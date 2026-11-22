const { test } = require('node:test');
const assert = require('node:assert/strict');
const { latestRelease } = require('./github-release.cjs');

const release = (tag_name, extra = {}) => async () => ({
  ok: true, json: async () => ({ tag_name, ...extra }),
});

test('compares numeric release versions and accepts v-prefixed tags', async () => {
  assert.deepEqual(await latestRelease('0.1.9', release('v0.1.10')), { version: '0.1.10', newer: true });
  assert.equal((await latestRelease('0.1.10', release('v0.1.10'))).newer, false);
  assert.equal((await latestRelease('0.1.11', release('v0.1.10'))).newer, false);
});

test('rejects malformed, draft, and prerelease responses', async () => {
  for (const fixture of [release('invalid'), release('v0.1.10', { draft: true }), release('v0.1.10', { prerelease: true })]) {
    await assert.rejects(latestRelease('0.1.0', fixture), /valid stable release/);
  }
});

test('reports missing releases and GitHub failures', async () => {
  await assert.rejects(latestRelease('0.1.0', async () => ({ ok: false, status: 404 })), /No published/);
  await assert.rejects(latestRelease('0.1.0', async () => ({ ok: false, status: 403 })), /403/);
});
