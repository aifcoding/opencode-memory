import { test, expect, describe, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * 进程级 stdio 协议测试：真实启动 CLI，走 MCP JSON-RPC（initialize / tools/list / tools/call）。
 * 验证的是 SDK 注册与协议层，而不是直接调用 ToolDefinition。
 */

interface StdinWriter {
  write(chunk: string): void;
}

interface JsonRpcReader {
  next(): Promise<string>;
}

function createLineReader(stream: ReadableStream<Uint8Array>): JsonRpcReader {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const bufferLines: string[] = [];
  const waiters: ((line: string) => void)[] = [];
  let buffer = '';
  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx = buffer.indexOf('\n');
        while (idx >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (line) {
            const waiter = waiters.shift();
            if (waiter) waiter(line);
            else bufferLines.push(line);
          }
          idx = buffer.indexOf('\n');
        }
      }
    } catch {
      // stream closed
    }
  })();
  return {
    next(timeoutMs = 10000): Promise<string> {
      const queued = bufferLines.shift();
      if (queued) return Promise.resolve(queued);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('MCP stdio response timeout')), timeoutMs);
        waiters.push((line) => {
          clearTimeout(timer);
          resolve(line);
        });
      });
    },
  };
}

function send(stdin: StdinWriter, message: unknown): void {
  stdin.write(`${JSON.stringify(message)}\n`);
}

async function call(
  stdin: StdinWriter,
  reader: JsonRpcReader,
  id: number,
  method: string,
  params?: unknown,
): Promise<any> {
  send(stdin, { jsonrpc: '2.0', id, method, params });
  for (;;) {
    const line = await reader.next();
    let parsed: { id?: number; [key: string]: unknown };
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (parsed.id === id) return parsed;
  }
}

describe('MCP stdio protocol', () => {
  let dir = '';
  let proc: ReturnType<typeof Bun.spawn> | undefined;
  let stdin: StdinWriter;
  let reader: JsonRpcReader;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'mcp-stdio-'));
    const configPath = join(dir, 'memory-mcp.jsonc');
    writeFileSync(
      configPath,
      JSON.stringify({
        dbPath: join(dir, 'memory.db'),
        scope: { scope: 'project', scopeKey: '/stdio-project' },
        profile: 'readonly',
        transport: { type: 'stdio' },
      }),
    );
    proc = Bun.spawn(['bun', 'packages/mcp/src/cli.ts', '--config', configPath], {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      cwd: process.cwd(),
    });
    stdin = proc.stdin as unknown as StdinWriter;
    reader = createLineReader(proc.stdout as ReadableStream<Uint8Array>);

    await call(stdin, reader, 1, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'stdio-test', version: '0.0.0' },
    });
    send(stdin, { jsonrpc: '2.0', method: 'notifications/initialized' });
  });

  afterAll(() => {
    proc?.kill();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  test('tools/list exposes exactly the readonly tools over the protocol', async () => {
    const response = await call(stdin, reader, 2, 'tools/list');
    const names = (response.result.tools as Array<{ name: string }>).map((t) => t.name).sort();
    expect(names).toEqual(['memory_list', 'memory_read', 'memory_search']);
  });

  test('tools/call runs a readonly tool and returns structuredContent', async () => {
    const response = await call(stdin, reader, 3, 'tools/call', {
      name: 'memory_list',
      arguments: {},
    });
    expect(response.result.structuredContent.schemaVersion).toBe(1);
    expect(response.result.structuredContent.kind).toBe('memory_list');
    const text = response.result.content[0].text as string;
    expect(text).toContain('<memory-context source="mcp">');
  });

  test('a write tool is not callable on the readonly profile', async () => {
    const response = await call(stdin, reader, 4, 'tools/call', {
      name: 'memory_store',
      arguments: { title: 'x', content: 'y' },
    });
    // readonly profile must not expose memory_store; the protocol responds with an error
    expect(response.error).toBeDefined();
  });
});
