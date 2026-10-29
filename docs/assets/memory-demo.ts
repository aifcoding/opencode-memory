// README GIF 用的确定性演示：直接调用插件真实工具，不经过模型。
// 运行前先构建：bun run --cwd packages/opencode build
import { rmSync } from 'node:fs';
import plugin from '../../packages/opencode/dist/plugin.js';

const dbPath = '/tmp/oc-memory-demo-script.db';
for (const suffix of ['', '-shm', '-wal']) rmSync(dbPath + suffix, { force: true });

const hooks = await (plugin as any).server(
  { client: undefined },
  { dbPath, autoUpdate: false },
);
const ctx = { sessionID: 'demo' };

console.log('[1/4] 记住');
console.log('❯ 记住：这个项目统一使用 Bun，不要用 npm 或 yarn。');
console.log(
  await hooks.tool.memory_store.execute(
    {
      title: '本项目统一使用 Bun 作为包管理器',
      content: '项目统一使用 Bun，不用 npm 或 yarn；安装、脚本、测试都用 bun / bunx。',
      type: 'convention',
      tags: ['bun', '包管理器', '项目约定'],
    },
    ctx,
  ),
);
await Bun.sleep(1200);

console.log('\n[2/4] 新会话召回');
console.log('❯ 这个项目用什么包管理器？');
console.log(await hooks.tool.memory_recall.execute({ query: '包管理器' }, ctx));
await Bun.sleep(1500);

console.log('\n[3/4] 固定为每轮上下文');
console.log('❯ 把这条固定。');
console.log(await hooks.tool.memory_pin.execute({ id: 1, pinned: true, pinMode: 'full' }, ctx));
await Bun.sleep(1000);

console.log('\n[4/4] 新会话自动注入');
console.log('❯ 不调工具，直接回答。');
const output: any = { messages: [{ info: { sessionID: 'demo' }, parts: [] }] };
await hooks['experimental.chat.messages.transform']({}, output);
const pinned = output.messages
  .at(-1)
  ?.parts?.find((part: any) => part.type === 'text')?.text;
console.log(pinned);
await Bun.sleep(1500);

// 先打印 DONE 让录制结束；进程退出时 SQLite 会自然关闭。
console.log('\n---\nDONE');
