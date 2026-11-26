import { test, expect, afterEach } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'jsonc-parser';
import { CONFIG_FILE_TEMPLATE, ensureConfigFile } from '../src/plugin-v1';
import { ensureRulesTemplate } from '../src/capture/rules';

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agent-memory-install-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test('first load writes a parseable default config and never overwrites it', () => {
  const dir = tempDir();
  const path = ensureConfigFile(dir);
  expect(path).toBe(join(dir, 'agent-memory.jsonc'));

  const parsed = parse(readFileSync(path!, 'utf8')) as Record<string, any>;
  expect(parsed.autoCapture).toEqual({ enabled: true, mode: 'on', maxWritesPerTurn: 3 });
  expect(parsed.autoRecall.mode).toBe('auto');
  // LLM 提取默认关闭，避免用户不知情时产生费用。
  expect(parsed.capture.enabled).toBe(false);
  expect(CONFIG_FILE_TEMPLATE).toContain('"enabled": false');

  writeFileSync(path!, '{ "pinQuota": 1234 }');
  expect(ensureConfigFile(dir)).toBeUndefined();
  expect(readFileSync(path!, 'utf8')).toContain('1234');
});

test('an existing config under any supported name blocks auto-generation', () => {
  for (const name of ['agent-memory.json', 'opencode-memory.jsonc', 'opencode-memory.json']) {
    const dir = tempDir();
    writeFileSync(join(dir, name), '{}');
    expect(ensureConfigFile(dir)).toBeUndefined();
    expect(existsSync(join(dir, 'agent-memory.jsonc'))).toBe(false);
  }
});

test('rules template is generated independently of capture.enabled', () => {
  const dir = tempDir();
  const path = join(dir, 'memory-capture.rules.md');
  expect(ensureRulesTemplate(path)).toBe(true);
  expect(ensureRulesTemplate(path)).toBe(false);
  expect(readFileSync(path, 'utf8')).toContain('template-version: 1');
});
