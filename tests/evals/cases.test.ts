import { beforeAll, describe, expect, it } from "vitest";
import { D } from "@/lib/core/money";
import { isTaskKind, parseTaskParams, type TaskKind } from "@/lib/agents/task-catalog";
import { loadAllCases, primeEvalModules, validateCase, isFixtureName, type HarnessEvalCase } from "@/evals/harness";

const MINIMUMS: Record<string, number> = { accounting: 100, fpa: 75, cash: 50, ap_ar: 50, payroll: 50, tax: 75, strategy: 50, compliance: 30, adversarial: 50 };

let cases: HarnessEvalCase[] = [];

beforeAll(async () => {
  process.env.TAU_EVALS_QUIET = "1";
  await primeEvalModules();
  cases = loadAllCases();
});

describe("eval case catalogue", () => {
  it("has at least 500 cases and meets every per-directory minimum", () => {
    expect(cases.length).toBeGreaterThanOrEqual(500);
    const by: Record<string, number> = {};
    for (const c of cases) by[c.directory] = (by[c.directory] ?? 0) + 1;
    for (const [dir, min] of Object.entries(MINIMUMS)) expect(by[dir] ?? 0, `${dir} minimum`).toBeGreaterThanOrEqual(min);
  });

  it("every case validates against the schema", () => {
    const bad = cases.map((c) => ({ id: c.id, v: validateCase(c) })).filter((x) => !x.v.ok);
    expect(bad.map((b) => `${b.id}: ${b.v.errors.join("; ")}`)).toEqual([]);
  });

  it("ids are unique", () => {
    const seen = new Set<string>();
    const dupes = cases.filter((c) => (seen.has(c.id) ? true : (seen.add(c.id), false))).map((c) => c.id);
    expect(dupes).toEqual([]);
  });

  it("every expected journal entry balances and every journal rubric's lines balance", () => {
    for (const c of cases) {
      const sets: { accountCode: string; debit?: string | number; credit?: string | number }[][] = [];
      if (c.expected.journalEntry) sets.push(c.expected.journalEntry.lines);
      for (const r of c.rubric) if (r.scorer === "journal" && Array.isArray(r.params?.lines)) sets.push(r.params!.lines as typeof sets[number]);
      for (const lines of sets) {
        const dr = lines.reduce((a, l) => a.plus(D(l.debit ?? 0)), D(0));
        const cr = lines.reduce((a, l) => a.plus(D(l.credit ?? 0)), D(0));
        expect(dr.minus(cr).abs().lte("0.005"), `${c.id} journal balances`).toBe(true);
        expect(dr.gt(0), `${c.id} journal non-empty`).toBe(true);
      }
    }
  });

  it("every task kind exists in the catalog and its params parse", () => {
    for (const c of cases) {
      if (!c.request.task) continue;
      expect(isTaskKind(c.request.task.kind), `${c.id} task kind`).toBe(true);
      expect(() => parseTaskParams(c.request.task!.kind as TaskKind, c.request.task!.params), `${c.id} params`).not.toThrow();
    }
  });

  it("every fixture is known and every case has the required fields", () => {
    for (const c of cases) {
      expect(isFixtureName(c.fixture), `${c.id} fixture ${c.fixture}`).toBe(true);
      expect(c.tags.length, `${c.id} tags`).toBeGreaterThan(0);
      expect(c.rubric.some((r) => r.scorer !== "manual"), `${c.id} scored rubric`).toBe(true);
      expect(c.scenario.length).toBeGreaterThan(10);
    }
  });

  it("generation is deterministic", () => {
    const again = loadAllCases();
    expect(again.map((c) => c.id)).toEqual(cases.map((c) => c.id));
    expect(JSON.stringify(again[0])).toEqual(JSON.stringify(cases[0]));
  });

  it("each directory ships hand-authored JSON cases", () => {
    for (const dir of Object.keys(MINIMUMS)) {
      expect(cases.filter((c) => c.directory === dir && c.generatedFrom === `evals/${dir}/cases.json`).length, `${dir} hand cases`).toBeGreaterThanOrEqual(10);
    }
  });
});
