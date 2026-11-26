import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** 全局命令目录（遵循 XDG_CONFIG_HOME）；与 OpenCode 的 commands 约定一致。 */
export function defaultCommandsDir(configDir?: string): string {
  const base =
    configDir ??
    (process.env.XDG_CONFIG_HOME
      ? join(process.env.XDG_CONFIG_HOME, 'opencode')
      : join(homedir(), '.config', 'opencode'));
  return join(base, 'commands');
}

/**
 * TUI 斜杠命令模板（中英双语）：提示模型调用已有工具，说明严格对齐工具真实参数与返回。
 * 只写入缺失文件，不覆盖用户已有命令。
 */
export const COMMAND_TEMPLATES: Readonly<Record<string, string>> = {
  'memory-list.md': `---
description: 列出长期记忆 / List memories
---

调用 memory_ls 工具列出已存记忆（参数 limit，1..200，默认 20；按更新时间倒序）。
English: call memory_ls and present id, type, title; do not invent trust/pin fields.
返回格式为 \`[id=X] 标题 (类型)\`。用表格展示 id、类型、标题。本步骤只列出记忆，不执行审批；最后问我要不要看某条详情或调整条件。
`,
  'memory-candidates.md': `---
description: 列出待审候选 / List candidates
---

调用 memory_candidates 工具列出候选（status 默认 pending；可传 suggestedDomain=code|user|business|uncertain；limit 1..20，默认 20）。
English: call memory_candidates and present id, domain, status, title.
用表格展示 id、domain、status、标题。本步骤只列出候选，不执行审批；最后问我处理哪些。
`,
  'memory-review.md': `---
description: 审批候选 / Review candidates
---

先调用 memory_candidates 获取待审候选 id。根据我的指示调用 memory_candidate_review 处理：$ARGUMENTS
English: call memory_candidate_review once per id with decision "approve" or "reject".
- 该工具一次只能处理一条：参数 { id, decision: "approve" | "reject" }
- 例如我说 "approve 12,13" → 分别调用 id=12、id=13
- 未指定时先列出候选并询问，是否处理由我确认。
`,
  'memory-search.md': `---
description: 搜索记忆 / Search memories
---

调用 memory_recall 工具检索：$ARGUMENTS
English: call memory_recall with a required query; use memory_read for full text.
参数：query 必填；可选 maxCharacters（1..20000）控制本次摘要预算。
展示返回的 id、标题、摘要与 trust；overflow 里的轻量导航也可列出；需要全文时用 memory_read(id)。
`,
};

/** 首次加载安装命令模板；返回本次新建的文件名。失败不阻断插件加载。 */
export function ensureCommandTemplates(configDir?: string): string[] {
  const dir = defaultCommandsDir(configDir);
  const created: string[] = [];
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    return created;
  }
  for (const [name, content] of Object.entries(COMMAND_TEMPLATES)) {
    const path = join(dir, name);
    if (existsSync(path)) continue;
    try {
      writeFileSync(path, content, { flag: 'wx' });
      created.push(name);
    } catch {
      // 单个文件失败不影响其他模板
    }
  }
  return created;
}
