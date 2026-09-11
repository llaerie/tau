import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Point the app at a fresh demo database in a temp directory. Must run before
 * any module that calls getConfig() is imported, so callers use dynamic imports.
 */
export function pointAtTempDemoDb(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fd-test-"));
  const file = path.join(dir, "test.db");
  process.env.FINANCE_DESK_MODE = "demo";
  process.env.FINANCE_DESK_DB = file;
  return file;
}
