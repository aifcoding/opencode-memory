# 发布前检查清单

> **两层结构**：每次必跑（10-15 分钟）+ 条件触发。
> 原则：每个高风险边界只保留**一个**最强、最接近真实环境的验证，不做重复验证。
> 事故教训：2026-09 的 2.0.0 单测全绿但 opencode 启动崩溃——「真实宿主加载」必须验证。

## 一、每次发布必跑（10–15 分钟）

### 1. 静态（仓库根目录）

```bash
bun run format:check && bun run typecheck && bun test && bun run build
```

- [ ] 全过（含通过/失败计数）
- [ ] 构建后**再跑一次** `bun test`（排除旧 `dist`）

### 2. 打包 + tarball 冒烟

```bash
export RELEASE_DIR="$(mktemp -d)"
(cd packages/core && npm pack --pack-destination "$RELEASE_DIR")
(cd packages/opencode && npm pack --pack-destination "$RELEASE_DIR")
(cd packages/mcp && npm pack --pack-destination "$RELEASE_DIR")
shasum -a 256 "$RELEASE_DIR"/*.tgz
```

- [ ] tarball 无绝对路径 / 依赖齐全 / 记录 SHA-256
- [ ] **按变动跑对应真实链路**：

| 变动的包 | 必跑的真实链路 |
|---|---|
| core | tarball 冒烟：store → recall → read → pin → close（中文召回） |
| opencode | `OPENCODE_CONFIG=<隔离配置> opencode models` → **exit 0**；`dist/plugin.js` 只导出 `default` |
| mcp | tarball 安装 → `memory-mcp --config` → initialize / tools/list / tools/call |
| 仅文档 | 不跑真实链路 |

### 3. 发布 + 发布后

- [ ] 顺序 publish 上面验证过的 tarball：core → opencode → mcp
- [ ] 发布后用 **npm 包名**重新干净安装 + 跑一遍关键链路
- [ ] GitHub Release notes：版本矩阵 / 变化 / 迁移版本 / 升级方式 / 已知限制 / 真实验证结果

## 二、条件触发（只在对应变更时跑）

| 变更类型 | 额外验证 |
|---|---|
| 新增数据库迁移 | 旧库升级（上一版数据库副本→新库打开→旧数据可读→再开不重复迁移）+ 多进程并发迁移（8 OS 进程） |
| 修改 Capture | **真实 OpenCode 提取链路**（compaction/手动 → 空 Session → 提取 Agent → 候选 → approve）+ 凭据/日志扫描（候选正文/tags/模型输出不泄漏） |
| 修改 MCP Profile / Registry | readonly / full 的真实 `tools/list` + allowed/denied 工具调用 |
| 修改构建 / exports / bin | tarball 干净安装 + 入口可执行 |
| 修改缓存 / 自更新 | staging / 并发 / 回滚 / 真实缓存升级 |
| 修改协议传输 | 官方 MCP Client E2E |
| Core 变更 | 三 Adapter（OpenCode/MCP）共享同一数据库兼容 |

## 三、已知 bug 版本处理（v2.0.0 的流程）

- [ ] `npm deprecate "<pkg>@<bad>" "<原因 + 升级指引>"`
- [ ] latest dist-tag 指向修复版
- [ ] GitHub Release 标 `--prerelease` + notes 顶部醒目警告（影响范围/症状/修复版本）
- [ ] 根因记录 + 永久防回归测试 + 把这次遗漏的检查项补进本清单

## 四、明确不做（YAGNI）

- annotations 人工核对（客户端提示，不影响权限/正确性）
- 正式数据库兼容矩阵（维护一句「Adapter 最低 Core 版本」即可）
- stderr 独立污染测试（协议管道天然分离，E2E 已覆盖）
- 纯文档改动跑真实链路

---

**说明**：版本 bump、commit/push 按 AGENTS.md 的 Git 规则走，不在本清单。
