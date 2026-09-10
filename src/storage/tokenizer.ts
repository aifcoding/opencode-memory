import { cut } from "jieba-wasm";

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
          .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
          .toLowerCase()
          .split(/[^a-zA-Z0-9_]+/)
          .filter(Boolean)
      );
    } else {
      // 含中文/标点：jieba 分词
      try {
        for (const w of cut(chunk)) {
          const t = w.trim().toLowerCase();
          if (t) words.push(t);
        }
      } catch {
        // 静默降级到基础分词（底层无 client，避免 console.error 污染 TUI）
        words.push(...chunk.toLowerCase().split(/[\s\p{P}]+/u).filter(Boolean));
      }
    }
  }
  // 过滤纯标点/空词
  return words.filter((w) => /[a-zA-Z0-9_\u4e00-\u9fff]/.test(w)).join(" ");
}
