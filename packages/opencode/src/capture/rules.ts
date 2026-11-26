import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DEFAULT_RULES } from '@aifcoding/memory-core';

/** 自动安装的规则模板文件（插件自有文件，不覆盖用户已有内容）。 */
export function defaultRulesPath(configDir?: string): string {
  const base =
    configDir ??
    (process.env.XDG_CONFIG_HOME
      ? join(process.env.XDG_CONFIG_HOME, 'opencode')
      : join(homedir(), '.config', 'opencode'));
  return join(base, 'memory-capture.rules.md');
}

export const RULES_TEMPLATE = `<!--
agent-memory 提取规则（可编辑）
template-version: 1

用途：调整提取偏好，例如优先保留哪些长期信息、排除哪些内容。
未配置 capture.instructionsFile 时，插件使用本文件；显式配置优先。
保存后在下次提取时读取。需要重置时，请先备份，再删除本文件并重启；
仍启用提取且未指定其他规则文件时，会重新生成默认模板。

程序会在本文件内容之后追加约束，声明冲突时以程序约束为准。
编辑本文件不能关闭来源筛选、基础风控或候选审批。
长度、措辞、引用等质量要求主要用于指导模型，不保证每次遵循。
提取结果仅为待审批候选，不会因此直接成为正式记忆。

本文件全文（包括注释）会随提取请求发送给模型。
请勿写入密码、token、密钥等凭据；脱敏不能保证识别所有秘密。
-->

## 默认策略

${DEFAULT_RULES}

## 自定义补充（可选）

<!--
在下方添加筛选偏好，而不是填写待保存的业务事实。
例如：优先保留可重复使用的排障结论，并注明适用环境。
无需补充时保持为空。
-->
`;

/**
 * 首次启用时创建规则模板；已存在则不动。返回是否新建。
 * 失败不阻断插件加载（回退内置默认规则）。
 */
export function ensureRulesTemplate(path: string): boolean {
  try {
    if (existsSync(path)) return false;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, RULES_TEMPLATE, { flag: 'wx' });
    return true;
  } catch {
    return false;
  }
}
