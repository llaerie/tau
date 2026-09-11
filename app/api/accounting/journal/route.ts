import { getRuntime } from "@/lib/db/runtime";
import { withApi, json, readJson } from "@/lib/ui/api";
import { createManualJournalEntry, type ManualJournalLineInput } from "@/lib/ui/manual-entry";
import { toPlain } from "@/lib/ui/serialize";

interface Body {
  date?: string;
  description?: string;
  memo?: string;
  lines?: ManualJournalLineInput[];
}

/** Create a DRAFT manual journal entry (OWNER / FINANCE_OPERATOR). Posting is a separate governed action. */
export const POST = withApi(async (req, _ctx, actor) => {
  const body = await readJson<Body>(req);
  const rt = await getRuntime();
  const entry = await createManualJournalEntry(rt, actor, { date: String(body.date ?? ""), description: String(body.description ?? ""), memo: typeof body.memo === "string" ? body.memo : undefined, lines: Array.isArray(body.lines) ? body.lines : [] });
  return json({ entry: toPlain(entry), message: `Draft entry #${entry.entryNumber} created (${entry.lines.length} lines). Post it from the Journal tab; posting is governed.` }, { status: 201 });
}, "PROPOSE_ACTIONS");
