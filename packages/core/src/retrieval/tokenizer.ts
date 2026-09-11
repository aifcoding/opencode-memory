import { cut } from 'jieba-wasm';

/**
 * Produces deterministic, whitespace-separated token text for FTS indexing and queries.
 * The same compatible tokenizer must be used for writes and reads. It may return an empty
 * string, should not depend on mutable external state, and its output is still processed
 * by SQLite FTS5 `unicode61`.
 */
export interface Tokenizer {
  tokenize(text: string): string;
}

// 中文用 jieba 分词；ASCII 标识符按 camelCase/下划线细分保留，避免被 jieba 拆散或与中文粘连。
export function tokenize(text: string): string {
  const words: string[] = [];
  // 先按 ASCII 标识符段与非 ASCII 段切分
  const chunks = text.split(/([a-zA-Z0-9_]+)/);
  for (const chunk of chunks) {
    if (!chunk) continue;
    if (/^[a-zA-Z0-9_]+$/.test(chunk)) {
      // 纯 ASCII：camelCase 拆分 + 小写
      words.push(
        ...chunk
          .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
          .toLowerCase()
          .split(/[^a-zA-Z0-9_]+/)
          .filter(Boolean),
      );
    } else {
      // 含中文/标点：jieba 分词
      try {
        for (const w of cut(chunk)) {
          const t = w.trim().toLowerCase();
          if (t) words.push(t);
        }
      } catch {
        // jieba 不可用时退化为基础分词，优先保证存取可用；降级后连续中文召回能力可能下降
        words.push(
          ...chunk
            .toLowerCase()
            .split(/[\s\p{P}]+/u)
            .filter(Boolean),
        );
      }
    }
  }
  // 过滤纯标点/空词
  return words.filter((w) => /[a-zA-Z0-9_\u4e00-\u9fff]/.test(w)).join(' ');
}

export const defaultTokenizer: Tokenizer = { tokenize };
