/**
 * Simulate the month-end close. Usage: npm run lab:close -- --period 2026-07 [--lock --approval <approvalId>]
 * Locking requires an APPROVED approval for a LOCK_PERIOD action; without one the run reports NEEDS_APPROVAL.
 */
import { getRuntime } from "@/lib/db/runtime";
import { runMonthEndClose } from "@/lib/workflows";
import { LAB_DEFAULT_ACTOR } from "@/lib/security/session";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const rt = await getRuntime();
  const periodId = arg("period") ?? rt.asOfDate.slice(0, 7);
  const result = await runMonthEndClose(rt, periodId, LAB_DEFAULT_ACTOR, { lock: process.argv.includes("--lock"), approvalId: arg("approval") });
  for (const s of result.steps) {
    console.log(`${String(s.step).padStart(2, " ")}. [${s.status.padEnd(14)}] ${s.title}`);
    for (const d of s.details.slice(0, 4)) console.log(`      - ${d}`);
    for (const e of s.exceptions) console.log(`      ! ${e}`);
  }
  console.log(`\nPeriod ${periodId}: locked=${result.locked} exceptions=${result.exceptions.length} audit=${result.auditEventId}`);
  await rt.flush();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
