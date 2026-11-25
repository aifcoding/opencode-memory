import { expect, test } from 'bun:test';
import { parseCaptureTarget, validateCaptureConfig } from '../src/domain/extraction';

test('disabled capture needs no target', () => {
  const check = validateCaptureConfig({ enabled: false });
  expect(check).toEqual({ ok: true, target: undefined });
});

test('enabled capture without target is rejected', () => {
  const check = validateCaptureConfig({ enabled: true });
  expect(check.ok).toBe(false);
  if (!check.ok) expect(check.reason).toContain('requires a target');
});

test('legacy agent maps to an agent target', () => {
  const check = validateCaptureConfig({ enabled: true, agent: ' build ' });
  expect(check).toEqual({ ok: true, target: { kind: 'agent', name: 'build' } });
});

test('target and legacy agent conflict', () => {
  const check = validateCaptureConfig({
    enabled: true,
    agent: 'build',
    target: { kind: 'agent', name: 'plan' },
  });
  expect(check.ok).toBe(false);
  if (!check.ok) expect(check.reason).toContain('conflicts');
});

test('model target requires provider and model', () => {
  expect(parseCaptureTarget({ kind: 'model', provider: 'p' })).toEqual({
    ok: false,
    reason: 'model target requires model',
  });
  expect(parseCaptureTarget({ kind: 'model', model: 'm' })).toEqual({
    ok: false,
    reason: 'model target requires provider',
  });
  expect(parseCaptureTarget({ kind: 'model', provider: 'extractor', model: 'gpt-x' })).toEqual({
    ok: true,
    target: { kind: 'model', provider: 'extractor', model: 'gpt-x' },
  });
});

test('host-default takes no extra fields', () => {
  expect(parseCaptureTarget({ kind: 'host-default' })).toEqual({
    ok: true,
    target: { kind: 'host-default' },
  });
  expect(parseCaptureTarget({ kind: 'host-default', model: 'x' }).ok).toBe(false);
});

test('unknown target kind and provider URL are rejected', () => {
  expect(parseCaptureTarget({ kind: 'auto' }).ok).toBe(false);
  expect(parseCaptureTarget({ kind: 'model', provider: 'https://u:p@host', model: 'm' }).ok).toBe(
    false,
  );
});

test('maxCandidates is bounded', () => {
  expect(validateCaptureConfig({ maxCandidates: 0 }).ok).toBe(false);
  expect(validateCaptureConfig({ maxCandidates: 21 }).ok).toBe(false);
  expect(validateCaptureConfig({ maxCandidates: 8 }).ok).toBe(true);
});
