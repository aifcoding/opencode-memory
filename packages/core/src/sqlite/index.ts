import { MemoryManager, type MemoryManagerOptions } from '../application/MemoryManager.js';
import { SqliteMemoryStore } from './SqliteMemoryStore.js';
import type { Tokenizer } from '../retrieval/tokenizer.js';

export { SqliteMemoryStore } from './SqliteMemoryStore.js';

/** Create a Bun SQLite-backed MemoryManager; `options.tokenizer` must remain compatible with existing indexes. */
export function createSqliteMemoryManager(
  options: Omit<MemoryManagerOptions, 'store'> & { dbPath: string; tokenizer?: Tokenizer },
): MemoryManager {
  return new MemoryManager({
    ...options,
    store: new SqliteMemoryStore(options.dbPath, options.tokenizer),
  });
}
