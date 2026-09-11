import { getRuntime } from "@/lib/db/runtime";
import { withApi, json, apiError, readJson } from "@/lib/ui/api";
import { loadWorkflows, MODULE_NOT_AVAILABLE } from "@/lib/ui/optional";
import { toPlain } from "@/lib/ui/serialize";
import { isValidISODate } from "@/lib/core/dates";

type Wf = { buildCpaPackage?: (rt: unknown, from: string, to: string) => Promise<unknown>; renderCpaPackageMarkdown?: (pkg: unknown) => string };

export const POST = withApi(async (req) => {
  const body = await readJson<{ from?: string; to?: string }>(req);
  const rt = await getRuntime();
  const to = body.to && isValidISODate(body.to) ? body.to : rt.asOfDate;
  const from = body.from && isValidISODate(body.from) ? body.from : `${to.slice(0, 4)}-01-01`;
  if (from > to) return apiError("from must be <= to");
  const { mod, notice } = await loadWorkflows<Wf>();
  if (!mod?.buildCpaPackage) return apiError(notice ?? `buildCpaPackage: ${MODULE_NOT_AVAILABLE}`, 503, "MODULE_NOT_AVAILABLE");
  const pkg = await mod.buildCpaPackage(rt, from, to);
  const markdown = mod.renderCpaPackageMarkdown ? mod.renderCpaPackageMarkdown(pkg) : null;
  await rt.flush();
  return json({ package: toPlain(pkg), markdown });
}, "VIEW_FINANCIALS");
