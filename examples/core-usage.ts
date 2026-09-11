import { createSqliteMemoryManager } from '@aifcoding/memory-core/sqlite';

const manager = createSqliteMemoryManager({ dbPath: '/tmp/opencode-memory-example.db' });

const memory = await manager.storeMemory({
  title: '项目运行约定',
  content: '安装依赖和运行脚本都使用 Bun。',
  summary: '项目统一使用 Bun',
  type: 'convention',
});

const result = await manager.recallMemories({ query: 'Bun' });
console.log(result.memories);

await manager.pinMemory({ id: memory.id, pinMode: 'summary' });
const context = await manager.getPinnedContext();
console.log(context.text);

await manager.close();
