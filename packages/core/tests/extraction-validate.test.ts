import { expect, test } from 'bun:test';
import { validateCaptureCandidates } from '../src/extraction/validate';

const material = 'atlas 仓库统一放 /srv/atlas，staging 的 API_PORT 固定 8080，已确认。';

const candidate = (overrides: Record<string, unknown> = {}) => ({
  title: 'atlas 仓库路径',
  content: 'atlas 仓库统一放在 /srv/atlas，部署脚本通过该路径取构件。',
  type: 'fact' as const,
  suggestedDomain: 'code' as const,
  evidenceQuote: 'atlas 仓库统一放 /srv/atlas',
  ...overrides,
});

test('keeps a well-formed candidate with matching evidence', () => {
  const result = validateCaptureCandidates(
    [candidate({ evidenceQuote: 'atlas 仓库统一放 /srv/atlas' })],
    material,
    8,
  );
  expect(result.candidates).toHaveLength(1);
  expect(result.filtered).toHaveLength(0);
});

test('keeps short, question-like and unknown-evidence candidates (quality moved to prompt)', () => {
  const result = validateCaptureCandidates(
    [
      candidate({ content: '太短' }),
      candidate({ content: '这是什么？' }),
      candidate({ evidenceQuote: '材料里没有这句话' }),
    ],
    material,
    8,
  );
  expect(result.candidates).toHaveLength(3);
  expect(result.filtered).toHaveLength(0);
});

test('same-title duplicates are structural-valid and kept (dedupe moved to prompt)', () => {
  const result = validateCaptureCandidates([candidate(), candidate()], material, 8);
  expect(result.candidates).toHaveLength(2);
  expect(result.filtered).toHaveLength(0);
});

test('respects maxCandidates after validation', () => {
  const many = Array.from({ length: 5 }, (_, index) =>
    candidate({ title: `atlas 路径 ${index}` }),
  );
  const result = validateCaptureCandidates(many, material, 2);
  expect(result.candidates).toHaveLength(2);
});
