import type {
  MemoryEntry,
  MemoryStore,
  SearchHit,
  SearchOptions,
  SummaryResult,
  UpdateContentResult,
} from '../../src/index';

export interface FakeHit {
  id: number;
  score: number;
}

function unsupported(): never {
  throw new Error('FakeStore: unsupported operation');
}

/**
 * Deterministic MemoryStore stub: `search` returns a fixed, score-ordered hit
 * list and `get` reads from the fixture map. All other operations are unused by
 * the recall read path.
 */
export class FakeStore implements MemoryStore {
  constructor(
    private readonly entries: MemoryEntry[],
    private readonly hits: FakeHit[],
  ) {}

  search(_query: string, options?: SearchOptions): SearchHit[] {
    return this.hits.slice(0, options?.limit ?? this.hits.length);
  }

  get(id: number): MemoryEntry | null {
    return this.entries.find((entry) => entry.id === id) ?? null;
  }

  create(): MemoryEntry {
    return unsupported();
  }
  updateMeta(): MemoryEntry | null {
    return unsupported();
  }
  updateContent(): UpdateContentResult {
    return unsupported();
  }
  softDelete(): boolean {
    return unsupported();
  }
  restore(): boolean {
    return unsupported();
  }
  listByScope(): MemoryEntry[] {
    return unsupported();
  }
  listPinned(): MemoryEntry[] {
    return unsupported();
  }
  pinWithinQuota(): { ok: boolean; size: number } {
    return unsupported();
  }
  archiveSummary(): boolean {
    return unsupported();
  }
  searchSummaries(): SummaryResult[] {
    return unsupported();
  }
  setKv(): void {
    unsupported();
  }
  getKv(): string | null {
    return unsupported();
  }
  listKv(): Record<string, string> {
    return unsupported();
  }
  deleteKv(): boolean {
    return unsupported();
  }
  close(): void {
    unsupported();
  }
}

/** Build a fully-populated MemoryEntry from a small fixture. */
export function makeMemory(
  input: Partial<MemoryEntry> & { id: number; title: string; content: string },
): MemoryEntry {
  return {
    scope: 'global',
    scopeKey: 'default',
    origin: 'user',
    trust: 'high',
    summary: '',
    type: 'fact',
    tags: [],
    pinnedAt: null,
    pinMode: 'summary',
    embedding: null,
    embedModel: null,
    embedDim: null,
    contentHash: `hash-${input.id}`,
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
    ...input,
  };
}

/** Deterministic fixture entries: title `T{n}`, summary `x`, content `C{n}`. */
export function fixtureEntries(count: number): MemoryEntry[] {
  return Array.from({ length: count }, (_, index) =>
    makeMemory({ id: index + 1, title: `T${index + 1}`, summary: 'x', content: `C${index + 1}` }),
  );
}

/** Deterministic score-descending hits matching `fixtureEntries`. */
export function fixtureHits(count: number): FakeHit[] {
  return Array.from({ length: count }, (_, index) => ({ id: index + 1, score: count - index }));
}

/** Hide optional store capabilities behind a proxy to exercise `unsupported`. */
export function withoutCapabilities<K extends keyof MemoryStore>(
  store: MemoryStore,
  capabilities: K[],
): MemoryStore {
  return new Proxy(store, {
    get(target, property, receiver) {
      if (typeof property === 'string' && (capabilities as string[]).includes(property))
        return undefined;
      return Reflect.get(target, property, receiver);
    },
  });
}
