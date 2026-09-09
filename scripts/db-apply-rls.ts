/**
 * Apply prisma/rls.sql (row-level security + audit immutability) to the configured database.
 * Usage: npm run db:rls   (requires DATABASE_URL; run after `prisma db push`)
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getPrismaClient, disconnectPrisma } from "@/lib/db/prisma-client";

const here = dirname(fileURLToPath(import.meta.url));
export const RLS_SQL_PATH = resolve(here, "..", "prisma", "rls.sql");

/**
 * Split the SQL file into statements. Dollar-quoted function bodies ($$ ... $$) may contain
 * semicolons, so the splitter tracks whether it is inside a dollar-quoted block.
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inDollar = false;
  const lines = sql.split("\n");
  for (const rawLine of lines) {
    const line = inDollar ? rawLine : rawLine.replace(/--.*$/, "");
    if (!inDollar && line.trim() === "") continue;
    const dollarCount = (line.match(/\$\$/g) ?? []).length;
    if (dollarCount % 2 === 1) inDollar = !inDollar;
    current += line + "\n";
    if (!inDollar && line.trimEnd().endsWith(";")) {
      statements.push(current.trim());
      current = "";
    }
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

export async function applyRls(): Promise<number> {
  const prisma = getPrismaClient();
  const statements = splitSqlStatements(readFileSync(RLS_SQL_PATH, "utf8"));
  await prisma.$transaction(async (tx) => {
    for (const stmt of statements) await tx.$executeRawUnsafe(stmt);
  });
  return statements.length;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  applyRls()
    .then((n) => {
      console.log(`Applied ${n} statements from prisma/rls.sql`);
      return disconnectPrisma();
    })
    .catch(async (err) => {
      console.error("Failed to apply RLS:", err);
      await disconnectPrisma();
      process.exit(1);
    });
}
