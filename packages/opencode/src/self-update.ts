import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PACKAGE_NAME = '@aifcoding/opencode-memory';
const REGISTRY_URL = 'https://registry.npmjs.org/@aifcoding/opencode-memory/latest';
const CACHE_DIR = join(
  homedir(),
  '.cache',
  'opencode',
  'packages',
  '@aifcoding',
  'opencode-memory@latest',
);

type Spawn = (command: string[], options: { cwd: string }) => { exited: Promise<number> };
export interface SelfUpdateDeps {
  fetch: typeof globalThis.fetch;
  spawn: Spawn;
  cacheDir: string;
}

export function readOwnVersion(): string {
  const packageJson = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { version: string };
  return packageJson.version;
}

export async function fetchLatestVersion(
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<string> {
  const response = await fetchImpl(REGISTRY_URL);
  if (!response.ok) throw new Error(`registry request failed: ${response.status}`);
  const body = (await response.json()) as { version?: unknown };
  if (typeof body.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(body.version))
    throw new Error('registry response has no valid version');
  return body.version;
}

export function isNewer(latest: string, current: string): boolean {
  const parse = (version: string) => version.split('.').map(Number);
  const a = parse(latest);
  const b = parse(current);
  for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return a[index] > b[index];
  return false;
}

function manifest(version: string) {
  return {
    private: true,
    dependencies: { [PACKAGE_NAME]: version },
  };
}

export function verifyOpenCodePluginCache(cacheDir: string, expectedVersion: string): void {
  const packageDir = join(cacheDir, 'node_modules', '@aifcoding', 'opencode-memory');
  const packageJsonPath = join(packageDir, 'package.json');
  if (!existsSync(packageJsonPath) || !existsSync(join(packageDir, 'dist', 'plugin.js')))
    throw new Error('updated package is incomplete');
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
    name?: string;
    version?: string;
  };
  if (packageJson.name !== PACKAGE_NAME || packageJson.version !== expectedVersion)
    throw new Error('updated package metadata mismatch');
}

export async function refreshCache(
  latestVersion: string,
  deps?: Partial<SelfUpdateDeps>,
): Promise<void> {
  const cacheDir = deps?.cacheDir ?? CACHE_DIR;
  const spawn = deps?.spawn ?? ((command, options) => Bun.spawn(command, options));
  mkdirSync(cacheDir, { recursive: true });
  const packageFile = join(cacheDir, 'package.json');
  const nodeModulePath = join(cacheDir, 'node_modules', '@aifcoding', 'opencode-memory');
  const backupPath = join(cacheDir, `.self-update-backup-${Date.now()}`);
  const lockFiles = ['bun.lock', 'bun.lockb', 'package-lock.json'].map((name) =>
    join(cacheDir, name),
  );
  const oldManifest = existsSync(packageFile) ? readFileSync(packageFile, 'utf8') : undefined;
  const oldLocks = lockFiles.map((file) => (existsSync(file) ? readFileSync(file) : undefined));
  let backedUp = false;
  try {
    if (existsSync(nodeModulePath)) {
      renameSync(nodeModulePath, backupPath);
      backedUp = true;
    }
    writeFileSync(packageFile, `${JSON.stringify(manifest(latestVersion), null, 2)}\n`);
    for (const lockFile of lockFiles) rmSync(lockFile, { force: true });
    const process = spawn(['bun', 'install', '--ignore-scripts'], { cwd: cacheDir });
    if ((await process.exited) !== 0) throw new Error('bun install failed');
    verifyOpenCodePluginCache(cacheDir, latestVersion);
    if (backedUp) rmSync(backupPath, { recursive: true, force: true });
  } catch (error) {
    rmSync(nodeModulePath, { recursive: true, force: true });
    if (backedUp) renameSync(backupPath, nodeModulePath);
    if (oldManifest === undefined) rmSync(packageFile, { force: true });
    else writeFileSync(packageFile, oldManifest);
    for (const [index, lockFile] of lockFiles.entries()) {
      rmSync(lockFile, { force: true });
      if (oldLocks[index]) writeFileSync(lockFile, oldLocks[index]);
    }
    throw error;
  }
}

export async function checkAndRefresh(
  deps?: Partial<SelfUpdateDeps>,
): Promise<{ status: 'up-to-date' | 'updated' | 'failed'; version?: string; error?: string }> {
  try {
    const current = readOwnVersion();
    const latest = await fetchLatestVersion(deps?.fetch ?? globalThis.fetch);
    if (!isNewer(latest, current)) return { status: 'up-to-date', version: current };
    await refreshCache(latest, deps);
    return { status: 'updated', version: latest };
  } catch (error) {
    return {
      status: 'failed',
      error: error instanceof Error ? error.message : 'self-update failed',
    };
  }
}
