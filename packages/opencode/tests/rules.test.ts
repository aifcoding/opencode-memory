import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_RULES } from '@aifcoding/memory-core';
import { RULES_TEMPLATE, defaultRulesPath, ensureRulesTemplate } from '../src/capture/rules';

test('rules path follows XDG config dir', () => {
  expect(defaultRulesPath('/tmp/cfg')).toBe('/tmp/cfg/memory-capture.rules.md');
});

test('template is created once and never overwritten', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rules-auto-'));
  const path = join(dir, 'memory-capture.rules.md');
  expect(ensureRulesTemplate(path)).toBe(true);
  expect(readFileSync(path, 'utf8')).toContain(DEFAULT_RULES);
  writeFileSync(path, '用户自定义规则');
  expect(ensureRulesTemplate(path)).toBe(false);
  expect(readFileSync(path, 'utf8')).toBe('用户自定义规则');
});

test('template carries a short explanation header', () => {
  expect(RULES_TEMPLATE).toContain('agent-memory 提取规则');
  expect(RULES_TEMPLATE).toContain('template-version: 1');
  expect(RULES_TEMPLATE).toContain('## 默认策略');
  expect(RULES_TEMPLATE).toContain('## 自定义补充');
});
