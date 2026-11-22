const semver = require('semver');

async function latestRelease(currentVersion, fetchRelease = fetch) {
  const response = await fetchRelease('https://api.github.com/repos/yashneil75/Simpld/releases/latest', {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Simpld-Updater' },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    if (response.status === 404) throw new Error('No published GitHub release is available yet.');
    throw new Error(`GitHub update check failed (${response.status}). Try again later.`);
  }
  const release = await response.json();
  const version = semver.valid(release.tag_name);
  if (!version || release.draft || release.prerelease) throw new Error('GitHub did not return a valid stable release.');
  return { version, newer: semver.gt(version, currentVersion) };
}

module.exports = { latestRelease };
