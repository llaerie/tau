import { getRuntime } from "@/lib/db/runtime";
import { withApi, json, readJson } from "@/lib/ui/api";
import { answerConfig } from "@/lib/ui/config";
import { historyOf } from "@/lib/knowledge/finance-bible";
import { toPlain } from "@/lib/ui/serialize";
import type { FieldStatus } from "@/lib/core/types";

interface Body {
  key?: string;
  value?: unknown;
  status?: FieldStatus;
  note?: string;
  section?: string;
  label?: string;
}

export const POST = withApi(async (req, _ctx, actor) => {
  const body = await readJson<Body>(req);
  const rt = await getRuntime();
  const current = await answerConfig(rt, actor, { key: String(body.key ?? ""), value: body.value, status: body.status, note: typeof body.note === "string" ? body.note : undefined, section: typeof body.section === "string" ? body.section : undefined, label: typeof body.label === "string" ? body.label : undefined });
  return json({ current: toPlain(current), history: toPlain(historyOf(rt.dataset.configFields, current.key)) });
}, "EDIT_CONFIG");
