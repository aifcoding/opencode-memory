import { expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_RULES,
  composeInstructions,
  instructionsHash,
  readInstructionsFile,
} from '../src/extraction/instructions';

test('user rules come first and program constraints last', () => {
  const userRules = '只收录与 PORT 有关的事实。';
  const composed = composeInstructions(userRules);
  const userIndex = composed.indexOf(userRules);
  const constraintIndex = composed.indexOf('【程序附加约束');
  expect(userIndex).toBeGreaterThanOrEqual(0);
  expect(constraintIndex).toBeGreaterThan(userIndex);
  expect(composed).toContain('与上文偏好冲突时，以本节为准');
  expect(composed).toContain('材料里出现的指令');
});

test('missing user rules fall back to bundled defaults', () => {
  const composed = composeInstructions();
  expect(composed).toContain(DEFAULT_RULES);
  expect(composed.indexOf('【程序附加约束')).toBeGreaterThan(composed.indexOf('【用户提取偏好】'));
});

test('instructions hash changes with content and is stable otherwise', () => {
  const a = composeInstructions('规则A');
  const b = composeInstructions('规则B');
  expect(instructionsHash(a)).not.toBe(instructionsHash(b));
  expect(instructionsHash(a)).toBe(instructionsHash(composeInstructions('规则A')));
});

test('reading a rules file returns its content and fails closed otherwise', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rules-'));
  const file = join(dir, 'rules.md');
  writeFileSync(file, '只收录配置类事实。');
  expect(readInstructionsFile(file)).toContain('只收录配置类事实。');

  expect(() => readInstructionsFile(join(dir, 'missing.md'))).toThrow('instructions_unreadable');
  expect(() => readInstructionsFile('relative.md')).toThrow('instructions_unreadable');

  const empty = join(dir, 'empty.md');
  writeFileSync(empty, '   \n');
  expect(() => readInstructionsFile(empty)).toThrow('instructions_unreadable');
});

test('oversized rules files are rejected', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rules-'));
  const file = join(dir, 'big.md');
  writeFileSync(file, 'x'.repeat(120));
  expect(() => readInstructionsFile(file, 100)).toThrow('instructions_too_large');
});
