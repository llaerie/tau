/** Generate the CPA package. Usage: npm run lab:cpa -- --from 2026-01-01 --to 2026-06-30 [--out docs/cpa-package.md] */
import { writeFileSync } from "node:fs";
import { getRuntime } from "@/lib/db/runtime";
import { buildCpaPackage, renderCpaPackageMarkdown } from "@/lib/workflows";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const rt = await getRuntime();
  const year = rt.asOfDate.slice(0, 4);
  const from = arg("from") ?? `${year}-01-01`;
  const to = arg("to") ?? rt.asOfDate;
  const pkg = await buildCpaPackage(rt, from, to);
  const md = renderCpaPackageMarkdown(pkg);
  const out = arg("out");
  if (out) {
    writeFileSync(out, md);
    console.log(`CPA package written to ${out}`);
  } else console.log(md);
  await rt.flush();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
