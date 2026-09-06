import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const registry = 'https://registry.npmjs.org';

function stableVersion(version) {
  if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error(`Expected stable major.minor.patch version: ${version}`);
  }
  const parts = version.split('.').map(Number);
  if (!parts.every(Number.isSafeInteger)) throw new Error(`Version exceeds safe integer range: ${version}`);
  return parts;
}

export async function registryMetadata(response) {
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Registry request failed: HTTP ${response.status}`);
  const metadata = await response.json();
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new Error('Invalid registry metadata');
  }
  return metadata;
}

export function selectVersion(localVersion, metadata, gitHead) {
  const local = stableVersion(localVersion);
  if (metadata === null) return localVersion;
  const latest = metadata['dist-tags']?.latest;
  const remote = stableVersion(latest);
  const versions = metadata.versions;
  if (!versions || typeof versions !== 'object' || Array.isArray(versions) || !Object.hasOwn(versions, latest)) {
    throw new Error('Invalid registry versions');
  }
  for (const version of Object.values(versions)) {
    if (!version || typeof version !== 'object' || Array.isArray(version) ||
        (version.gitHead !== undefined && typeof version.gitHead !== 'string')) {
      throw new Error('Invalid registry version metadata');
    }
  }
  if (Object.values(versions).some(version => version.gitHead === gitHead)) return null;
  remote[2] += 1;
  const next = remote.join('.');
  stableVersion(next);
  for (let i = 0; i < 3; i++) {
    if (local[i] !== remote[i]) return local[i] > remote[i] ? localVersion : next;
  }
  return localVersion;
}

if (import.meta.main) {
  const cwd = fileURLToPath(new URL('../', import.meta.url));
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  if (typeof manifest.name !== 'string' || !manifest.name.trim()) throw new Error('Missing package name');
  const gitHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
  const response = await fetch(`${registry}/${encodeURIComponent(manifest.name)}`, {
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  });
  const version = selectVersion(manifest.version, await registryMetadata(response), gitHead);
  if (version === null) {
    console.log(`Commit ${gitHead} is already published; skipping.`);
  } else {
    execFileSync('npm', ['version', version, '--no-git-tag-version', '--ignore-scripts', '--allow-same-version'], { cwd, stdio: 'inherit' });
    execFileSync('npm', ['publish', '--access', 'public', '--provenance', `--registry=${registry}`], { cwd, stdio: 'inherit' });
  }
}
