import type { ConfigField } from "@/lib/core/types";
import type { LabRuntime } from "@/lib/db/runtime";
import type { Actor, FieldStatus } from "@/lib/core/types";
import { applyConfigAnswer, getField, mergeBibleFields, sectionOf } from "@/lib/knowledge/finance-bible";

/** Merged view: real bible fields overlaid with persisted answers from dataset.configFields (same key). */
export function mergedConfigFields(bible: ConfigField[], persisted: ConfigField[]): ConfigField[] {
  return mergeBibleFields(bible, persisted);
}

import { thresholdsFromConfig } from "@/lib/risk/materiality";
import { TauError } from "@/lib/core/errors";

export interface AnswerConfigInput {
  key: string;
  value: unknown;
  status?: FieldStatus;
  note?: string;
  section?: string;
  label?: string;
  eventType?: string;
}

/** Record a config answer into dataset.configFields (history kept as SUPERSEDED), refresh thresholds and audit it. */
export async function answerConfig(rt: LabRuntime, actor: Actor, input: AnswerConfigInput): Promise<ConfigField> {
  const key = input.key.trim();
  if (!key) throw new TauError("BAD_REQUEST", "key is required");
  const status: Exclude<FieldStatus, "SUPERSEDED"> = input.status === "UNCONFIRMED" || input.status === "PROFESSIONAL_REVIEW_REQUIRED" ? input.status : "CONFIRMED";
  let value = input.value === undefined ? null : input.value;
  if (typeof value === "string" && value.trim() === "") value = null;
  if (status === "CONFIRMED" && value === null) throw new TauError("NULL_VALUE", "A CONFIRMED answer needs a value; use UNCONFIRMED to record a note only");
  const merged = mergedConfigFields(rt.bible, rt.dataset.configFields);
  const known = getField(merged, key) ?? rt.dataset.configFields.find((f) => f.key === key && f.status !== "SUPERSEDED");
  const section = known?.section ?? sectionOf(key) ?? input.section;
  if (!section) throw new TauError("UNKNOWN_KEY", `Unknown config key ${key}; provide a section for new keys`);
  const base: ConfigField[] = rt.dataset.configFields.some((f) => f.key === key) ? rt.dataset.configFields : [...rt.dataset.configFields, known ? { ...known } : { key, section, label: input.label ?? key, value: null, status: "UNCONFIRMED", synthetic: false }];
  const result = applyConfigAnswer(base, key, value, actor, status, { note: input.note });
  rt.dataset.configFields = result.fields;
  await rt.store.upsertMany("configFields", result.fields.filter((f) => f.key === key));
  Object.assign(rt.thresholds, thresholdsFromConfig(rt.dataset.configFields));
  await rt.audit.record({ actor, workflowVersion: "console:config:v1", eventType: input.eventType ?? "CONFIG_ANSWERED", explanation: `Config field ${key} set to status ${status} via console`, beforeState: known ? { status: known.status, hasValue: known.value !== null } : undefined, afterState: { status, hasValue: value !== null } });
  await rt.flush();
  return result.current;
}
