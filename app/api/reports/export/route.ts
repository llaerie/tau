import { getRuntime } from "@/lib/db/runtime";
import { withApi, apiError, json } from "@/lib/ui/api";
import { toPlain } from "@/lib/ui/serialize";
import { isValidISODate, monthStart } from "@/lib/core/dates";
import { renderStatementsMarkdown } from "@/lib/ui/reports";

/** GET ?kind=income_statement|balance_sheet|cash_flow|trial_balance|all&from=&to=&format=json|md → download. */
export const GET = withApi(async (req) => {
  const url = new URL(req.url);
  const rt = await getRuntime();
  const kind = url.searchParams.get("kind") ?? "all";
  const format = url.searchParams.get("format") === "md" ? "md" : "json";
  const to = url.searchParams.get("to") ?? rt.asOfDate;
  const from = url.searchParams.get("from") ?? `${to.slice(0, 4)}-01-01`;
  if (!isValidISODate(from) || !isValidISODate(to) || from > to) return apiError("from/to must be valid ISO dates with from <= to");
  const L = rt.ledger;
  const payload: Record<string, unknown> = { company: rt.dataset.profile.displayName, isSynthetic: rt.dataset.profile.isSynthetic, from, to, generatedAt: new Date().toISOString() };
  if (kind === "income_statement" || kind === "all") payload.incomeStatement = L.incomeStatement(from, to);
  if (kind === "balance_sheet" || kind === "all") payload.balanceSheet = L.balanceSheet(to);
  if (kind === "cash_flow" || kind === "all") payload.cashFlow = L.cashFlowStatement(from, to);
  if (kind === "trial_balance" || kind === "all") payload.trialBalance = L.trialBalance(to, kind === "trial_balance" ? undefined : monthStart(from) === from ? undefined : undefined);
  if (Object.keys(payload).length <= 5) return apiError(`Unknown kind ${kind}`);
  const name = `tau-${kind}-${from}-${to}`;
  if (format === "md") {
    const md = renderStatementsMarkdown(rt, from, to, kind);
    return new Response(md, { headers: { "content-type": "text/markdown; charset=utf-8", "content-disposition": `attachment; filename="${name}.md"` } });
  }
  return json(toPlain(payload), { headers: { "content-disposition": `attachment; filename="${name}.json"` } });
}, "VIEW_FINANCIALS");
