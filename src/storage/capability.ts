import type { Database } from "bun:sqlite";

export interface CapabilityReport {
  sqliteVersion: string;
  fts5: boolean;
  compileOptions: string[];
}

export function checkCapabilities(db: Database): CapabilityReport {
  const version = (db.query(`SELECT sqlite_version() v`).get() as { v: string }).v;
  const compileOptions = (db.query(`PRAGMA compile_options`).all() as { compile_options: string }[]).map(
    (r) => r.compile_options
  );
  const fts5 = compileOptions.includes("ENABLE_FTS5");
  if (!fts5) {
    throw new Error("SQLite build lacks FTS5; opencode-memory requires FTS5");
  }
  return { sqliteVersion: version, fts5, compileOptions };
}
