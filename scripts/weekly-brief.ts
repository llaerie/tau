/** Print the weekly CFO brief for the lab company. Usage: npm run lab:brief -- [--as-of YYYY-MM-DD] [--json] */
import { getRuntime } from "@/lib/db/runtime";
import { buildWeeklyBrief, renderWeeklyBriefMarkdown } from "@/lib/workflows";

async function main() {
  const i = process.argv.indexOf("--as-of");
  const asOf = i >= 0 ? process.argv[i + 1] : undefined;
  const rt = await getRuntime();
  const brief = await buildWeeklyBrief(rt, asOf);
  if (process.argv.includes("--json")) console.log(JSON.stringify(brief, null, 2));
  else console.log(renderWeeklyBriefMarkdown(brief));
  await rt.flush();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
