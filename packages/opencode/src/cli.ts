#!/usr/bin/env bun
/** 待审候选的终端入口：list / approve / reject。与插件共享同一个 SQLite。 */
import { createSqliteMemoryManager } from '@aifcoding/memory-core/sqlite';
import { defaultDbPath, readConfigFile } from './plugin-v1.js';

interface Args {
  dbPath?: string;
  scope?: string;
  list: boolean;
  approve: number[];
  reject: number[];
  allApprove: boolean;
  allReject: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { list: false, approve: [], reject: [], allApprove: false, allReject: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    const next = () => argv[++i] ?? '';
    const ids = (value: string) =>
      value
        .split(',')
        .map((part) => Number(part.trim()))
        .filter((id) => Number.isInteger(id) && id > 0);
    if (arg === '--db') args.dbPath = next();
    else if (arg === '--scope') args.scope = next();
    else if (arg === '--list') args.list = true;
    else if (arg === '--approve') args.approve.push(...ids(next()));
    else if (arg === '--reject') args.reject.push(...ids(next()));
    else if (arg === '--all-approve') args.allApprove = true;
    else if (arg === '--all-reject') args.allReject = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(
        '用法: memory-review [--db <path>] [--scope <key>] [--list] [--approve 1,2] [--reject 3] [--all-approve|--all-reject]',
      );
      process.exit(0);
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const scope = { scope: 'global' as const, scopeKey: args.scope ?? 'default' };
  const configured = (() => {
    try {
      const dbPath = (readConfigFile() as { dbPath?: unknown }).dbPath;
      return typeof dbPath === 'string' && dbPath ? dbPath : undefined;
    } catch {
      return undefined;
    }
  })();
  const manager = createSqliteMemoryManager({ dbPath: args.dbPath ?? configured ?? defaultDbPath() });

  try {
    const listPending = () => manager.listMemoryCandidates({ scope, status: 'pending', limit: 100 });
    const pending = await listPending();

    if (pending.length === 0) {
      console.log('当前没有待审批候选。');
      return;
    }

    const approve = new Set(args.approve);
    const reject = new Set(args.reject);
    let approvedAll = 0;
    let rejectedAll = 0;
    if (args.allApprove || args.allReject) {
      // 分页处理直到清空，避免只处理首页 100 条。
      for (;;) {
        const batch = await listPending();
        if (batch.length === 0) break;
        for (const candidate of batch) {
          const result = await manager.reviewMemoryCandidate({
            id: candidate.id,
            scope,
            decision: args.allApprove ? 'approve' : 'reject',
          });
          if (result.status === 'approved' || result.status === 'already_exists') approvedAll += 1;
          else if (result.status === 'rejected') rejectedAll += 1;
        }
        if (batch.length < 100) break;
      }
      console.log(`批量处理：已批准 ${approvedAll} 条，已拒绝 ${rejectedAll} 条。`);
      return;
    }

    if (approve.size === 0 && reject.size === 0) {
      console.log(`待审批候选 ${pending.length} 条：`);
      for (const candidate of pending) {
        const summary = (candidate.summary || candidate.content).replace(/\s+/g, ' ').slice(0, 60);
        console.log(`  [${candidate.id}] ${candidate.title} (${candidate.type}/${candidate.suggestedDomain}) — ${summary}`);
      }
      console.log('\n批准: memory-review --approve 1,2    拒绝: memory-review --reject 3');
      return;
    }

    let approved = 0;
    let rejected = 0;
    const missing: number[] = [];
    for (const id of [...approve, ...reject]) {
      const known = pending.some((candidate) => candidate.id === id);
      if (!known) {
        const read = await manager.readMemoryCandidate({ id, scope });
        if (read.status !== 'found' || read.candidate.status !== 'pending') {
          missing.push(id);
          continue;
        }
      }
      const result = await manager.reviewMemoryCandidate({ id, scope, decision: approve.has(id) ? 'approve' : 'reject' });
      if (result.status === 'approved' || result.status === 'already_exists') approved += 1;
      else if (result.status === 'rejected') rejected += 1;
      else missing.push(id);
    }
    console.log(`已批准 ${approved} 条，已拒绝 ${rejected} 条${missing.length ? `，未处理 ${missing.join(',')}` : ''}。`);
  } finally {
    manager.close();
  }
}

main().catch((error) => {
  console.error('memory-review 失败:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
