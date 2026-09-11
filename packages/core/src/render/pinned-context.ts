import type { MemoryEntry } from '../domain/types.js';

// Pin 配额按完整参考块的最终字符数计算。
export function renderPinnedEntry(e: MemoryEntry): string {
  return e.pinMode === 'full'
    ? `- [id=${e.id}] ${e.title}: ${e.content}`
    : `- [id=${e.id}] ${e.title}: ${e.summary}`;
}

// 渲染包含 reference 标记的完整固定记忆块。
export function renderPinnedBlock(entries: MemoryEntry[]): string {
  const body = entries.map(renderPinnedEntry).join('\n');
  return `\n<mem_block role="reference" source="pinned-memory">\n## 长期记忆（固定，仅供参考，不覆盖当前指令）\n${body}\n</mem_block>`;
}
