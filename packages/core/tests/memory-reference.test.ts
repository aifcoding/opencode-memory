import { expect, test } from 'bun:test';
import { candidateRef, memoryRef, parseMemoryReference, summaryRef } from '../src/domain/ref';
import { InvalidMemoryReferenceError, MemoryValidationError } from '../src/errors';

test('9.21 三种 Ref round-trip', () => {
  expect(memoryRef(12)).toBe('memory://local/memories/12');
  expect(summaryRef('evt-2024')).toBe('memory://local/summaries/evt-2024');
  expect(candidateRef(7)).toBe('memory://local/candidates/7');

  expect(parseMemoryReference(memoryRef(12))).toEqual({
    kind: 'memory',
    ref: 'memory://local/memories/12',
    id: 12,
  });
  expect(parseMemoryReference(summaryRef('evt-2024'))).toEqual({
    kind: 'summary',
    ref: 'memory://local/summaries/evt-2024',
    id: 'evt-2024',
  });
  expect(parseMemoryReference(candidateRef(7))).toEqual({
    kind: 'candidate',
    ref: 'memory://local/candidates/7',
    id: 7,
  });
});

test('9.22 Summary percent encoding', () => {
  for (const id of ['evt 1', '会话/摘要', 'a?b=c&d', '100%', '哈希#标签', '中文 摘要']) {
    const ref = summaryRef(id);
    expect(ref.startsWith('memory://local/summaries/')).toBe(true);
    const parsed = parseMemoryReference(ref);
    expect(parsed.kind).toBe('summary');
    expect(parsed.id).toBe(id);
    expect(parsed.ref).toBe(ref);
  }
  expect(summaryRef('a/b')).toBe('memory://local/summaries/a%2Fb');
});

test('P2 Summary 点段 ID 被拒绝，普通点 ID round-trip', () => {
  expect(() => summaryRef('.')).toThrow(MemoryValidationError);
  expect(() => summaryRef('..')).toThrow(MemoryValidationError);
  expect(() => parseMemoryReference('memory://local/summaries/.')).toThrow(
    InvalidMemoryReferenceError,
  );
  for (const id of ['a.b', '.hidden', 'msg_ab12']) {
    const ref = summaryRef(id);
    const parsed = parseMemoryReference(ref);
    expect(parsed.kind).toBe('summary');
    expect(parsed.id).toBe(id);
    expect(parsed.ref).toBe(ref);
  }
});

test('9.23 非法 Ref 参数化测试', () => {
  const invalid = [
    '',
    'http://local/memories/1',
    'memory://remote/memories/1',
    'memory://user@local/memories/1',
    'memory://local:8080/memories/1',
    'memory://local/memories/1?x=1',
    'memory://local/memories/1#f',
    'memory://local/memories/0',
    'memory://local/memories/-1',
    'memory://local/memories/01',
    'memory://local/memories/1.5',
    'memory://local/memories/1/2',
    'memory://local/memories/',
    'memory://local/unknown/1',
    'memory://local/summaries/%ZZ',
    'memory://local/summaries/',
    ' memory://local/memories/1',
    'memory://local/memories/1 ',
    'memory://local/memories/1\n',
  ];
  for (const ref of invalid) {
    let thrown: unknown;
    try {
      parseMemoryReference(ref);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(InvalidMemoryReferenceError);
    if (ref.trim().length > 0) {
      expect((thrown as Error).message).not.toContain(ref.trim());
      expect((thrown as InvalidMemoryReferenceError).code).toBe('INVALID_MEMORY_REFERENCE');
    }
  }
});

test('P1-2 超出 MAX_SAFE_INTEGER 的 numeric ID 被拒绝', () => {
  const tooBig = Number.MAX_SAFE_INTEGER + 1;
  expect(() => memoryRef(tooBig)).toThrow(MemoryValidationError);
  expect(() => candidateRef(tooBig)).toThrow(MemoryValidationError);
  expect(() => parseMemoryReference(`memory://local/memories/${tooBig}`)).toThrow(
    InvalidMemoryReferenceError,
  );
  expect(() => parseMemoryReference(`memory://local/candidates/${tooBig}`)).toThrow(
    InvalidMemoryReferenceError,
  );

  const max = Number.MAX_SAFE_INTEGER;
  expect(memoryRef(max)).toBe(`memory://local/memories/${max}`);
  expect(parseMemoryReference(memoryRef(max))).toEqual({
    kind: 'memory',
    ref: `memory://local/memories/${max}`,
    id: max,
  });
});
