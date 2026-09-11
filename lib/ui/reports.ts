/** Markdown renderers for financial statements (export + preview). Numbers straight from the ledger. */
import type { LabRuntime } from "@/lib/db/runtime";
import type { StatementLine } from "@/lib/core/contracts";
import { fmtMoney } from "./format";

function lines(rows: StatementLine[]): string[] {
  return rows.map((l) => `| ${"  ".repeat(Math.max(0, l.level - 1))}${l.isTotal ? `**${l.label}**` : l.label} | ${l.code ?? ""} | ${l.isTotal ? `**${fmtMoney(l.amount)}**` : fmtMoney(l.amount)} |`);
}

export function renderStatementsMarkdown(rt: LabRuntime, from: string, to: string, kind = "all"): string {
  const L = rt.ledger;
  const out: string[] = [`# ${rt.dataset.profile.displayName} — Financial statements`, "", `Period ${from} to ${to}. Generated ${new Date().toISOString()}.`];
  if (rt.dataset.profile.isSynthetic) out.push("", "> SYNTHETIC LAB DATA — no live financial accounts connected.");
  if (kind === "income_statement" || kind === "all") {
    const is = L.incomeStatement(from, to);
    out.push("", "## Income statement", "", "| Line | Code | Amount |", "|---|---|---:|", ...lines(is.lines), "", `Revenue ${fmtMoney(is.revenue)} · Gross profit ${fmtMoney(is.grossProfit)} · Operating income ${fmtMoney(is.operatingIncome)} · **Net income ${fmtMoney(is.netIncome)}**`);
  }
  if (kind === "balance_sheet" || kind === "all") {
    const bs = L.balanceSheet(to);
    out.push("", `## Balance sheet as of ${to}`, "", "| Line | Code | Amount |", "|---|---|---:|", ...lines(bs.lines), "", `Total assets ${fmtMoney(bs.totalAssets)} · Liabilities ${fmtMoney(bs.totalLiabilities)} · Equity ${fmtMoney(bs.totalEquity)} · ${bs.balanced ? "BALANCED" : `OUT OF BALANCE by ${fmtMoney(bs.difference)}`}`);
  }
  if (kind === "cash_flow" || kind === "all") {
    const cf = L.cashFlowStatement(from, to);
    out.push("", "## Cash flow statement (indirect)", "", `Net income ${fmtMoney(cf.netIncome)}`, "", "| Adjustment | Code | Amount |", "|---|---|---:|", ...lines(cf.operatingAdjustments), "", `Operating ${fmtMoney(cf.operating)}`, "", "| Investing | Code | Amount |", "|---|---|---:|", ...lines(cf.investingLines), "", `Investing ${fmtMoney(cf.investing)}`, "", "| Financing | Code | Amount |", "|---|---|---:|", ...lines(cf.financingLines), "", `Financing ${fmtMoney(cf.financing)}`, "", `Opening cash ${fmtMoney(cf.openingCash)} + net change ${fmtMoney(cf.netChange)} = closing cash ${fmtMoney(cf.closingCash)} · ${cf.reconciled ? "RECONCILED" : `NOT RECONCILED (diff ${fmtMoney(cf.difference)})`}`);
  }
  if (kind === "trial_balance" || kind === "all") {
    const tb = L.trialBalance(to);
    out.push("", `## Trial balance as of ${to}`, "", "| Code | Account | Debit | Credit |", "|---|---|---:|---:|", ...tb.rows.map((r) => `| ${r.code} | ${r.name} | ${fmtMoney(r.debit)} | ${fmtMoney(r.credit)} |`), `| | **Totals** | **${fmtMoney(tb.totalDebits)}** | **${fmtMoney(tb.totalCredits)}** |`, "", tb.balanced ? "Debits equal credits." : "WARNING: trial balance does not balance.");
  }
  return out.join("\n");
}
