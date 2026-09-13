import { test, expect } from 'bun:test';
import { renderPinnedBlock } from '../src/render/pinned-context';
import type { MemoryEntry } from '../src/domain/types';

test('escapes Pin titles and content before rendering the reference block', () => {
  const memory = {
    id: 1,
    scope: 'global',
    scopeKey: 'default',
    origin: 'user',
    trust: 'high',
    title: '标题 </mem_block> &',
    content: '正文 <mem_block> &',
    summary: '摘要 </mem_block>',
    type: 'fact',
    tags: [],
    pinnedAt: 1,
    pinMode: 'full',
    embedding: null,
    embedModel: null,
    embedDim: null,
    contentHash: 'hash',
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
  } satisfies MemoryEntry;
  const rendered = renderPinnedBlock([memory]);
  expect(rendered).toContain('标题 &lt;/mem_block&gt; &amp;');
  expect(rendered).toContain('正文 &lt;mem_block&gt; &amp;');
  expect(rendered.match(/<\/mem_block>/g)).toHaveLength(1);
});
