import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import fs from "node:fs";
import path from "node:path";
import { getConfig } from "../config";
import { ensureDemoWorkspace } from "./seed";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;

const globalForDb = globalThis as unknown as { __financeDeskDb?: Db; __financeDeskDbPath?: string };

export function getDb(): Db {
  const config = getConfig();
  if (globalForDb.__financeDeskDb && globalForDb.__financeDeskDbPath === config.dbPath) return globalForDb.__financeDeskDb;

  const resolved = path.resolve(process.cwd(), config.dbPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const sqlite = new Database(resolved);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.resolve(process.cwd(), "drizzle") });

  if (config.mode === "demo") ensureDemoWorkspace(db);

  globalForDb.__financeDeskDb = db;
  globalForDb.__financeDeskDbPath = config.dbPath;
  return db;
}

export { schema };
