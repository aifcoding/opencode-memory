import { test, expect } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkAndRefresh, isNewer } from '../src/self-update';

test('compares semantic patch versions', () => {
  expect(isNewer('0.1.5', '0.1.4')).toBe(true);
  expect(isNewer('0.1.4', '0.1.4')).toBe(false);
  expect(isNewer('0.1.3', '0.1.4')).toBe(false);
  expect(isNewer('1.0.0', '0.9.9')).toBe(true);
});

test('latest version skips refresh when already current', async () => {
  let spawned = false;
  const result = await checkAndRefresh({
    cacheDir: '/tmp/opencode-memory-self-update-current',
    fetch: async () => new Response(JSON.stringify({ version: '0.1.4' }), { status: 200 }),
    spawn: () => {
      spawned = true;
      return { exited: Promise.resolve(0) };
    },
  });
  expect(result.status).toBe('up-to-date');
  expect(spawned).toBe(false);
});

test('refreshes only the scoped package cache when a newer version exists', async () => {
  const cacheDir = `/tmp/opencode-memory-self-update-${Date.now()}`;
  try {
    let command: string[] = [];
    const result = await checkAndRefresh({
      cacheDir,
      fetch: async () => new Response(JSON.stringify({ version: '9.9.9' }), { status: 200 }),
      spawn: (nextCommand, options) => {
        command = nextCommand;
        const packageDir = join(options.cwd, 'node_modules', '@aifcoding', 'opencode-memory');
        mkdirSync(join(packageDir, 'dist'), { recursive: true });
        writeFileSync(
          join(packageDir, 'package.json'),
          JSON.stringify({ name: '@aifcoding/opencode-memory', version: '9.9.9' }),
        );
        writeFileSync(join(packageDir, 'dist', 'plugin.js'), '');
        return { exited: Promise.resolve(0) };
      },
    });
    expect(result.status).toBe('updated');
    expect(command).toEqual(['bun', 'install', '--ignore-scripts']);
    expect(existsSync(join(cacheDir, 'package.json'))).toBe(true);
    expect(JSON.parse(readFileSync(join(cacheDir, 'package.json'), 'utf8')).name).toBeUndefined();
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test('version mismatch fails and restores the old cache', async () => {
  const cacheDir = `/tmp/opencode-memory-self-update-mismatch-${Date.now()}`;
  const packageDir = join(cacheDir, 'node_modules', '@aifcoding', 'opencode-memory');
  try {
    mkdirSync(join(packageDir, 'dist'), { recursive: true });
    writeFileSync(join(cacheDir, 'package.json'), JSON.stringify({ private: true }));
    writeFileSync(join(cacheDir, 'package-lock.json'), 'old-lock');
    writeFileSync(
      join(packageDir, 'package.json'),
      JSON.stringify({ name: '@aifcoding/opencode-memory', version: '0.1.4' }),
    );
    writeFileSync(join(packageDir, 'dist', 'plugin.js'), 'old');
    const result = await checkAndRefresh({
      cacheDir,
      fetch: async () => new Response(JSON.stringify({ version: '9.9.9' }), { status: 200 }),
      spawn: () => {
        const nextPackageDir = join(cacheDir, 'node_modules', '@aifcoding', 'opencode-memory');
        mkdirSync(join(nextPackageDir, 'dist'), { recursive: true });
        writeFileSync(
          join(nextPackageDir, 'package.json'),
          JSON.stringify({ name: '@aifcoding/opencode-memory', version: '0.0.1' }),
        );
        writeFileSync(join(nextPackageDir, 'dist', 'plugin.js'), 'bad');
        return { exited: Promise.resolve(0) };
      },
    });
    expect(result.status).toBe('failed');
    expect(JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')).version).toBe(
      '0.1.4',
    );
    expect(readFileSync(join(packageDir, 'dist', 'plugin.js'), 'utf8')).toBe('old');
    expect(readFileSync(join(cacheDir, 'package-lock.json'), 'utf8')).toBe('old-lock');
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test('network failure is silent and returns failed', async () => {
  const result = await checkAndRefresh({
    fetch: async () => {
      throw new Error('network unavailable');
    },
  });
  expect(result.status).toBe('failed');
  expect(result.error).toBe('network unavailable');
});
