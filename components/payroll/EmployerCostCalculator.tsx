"use client";
import { useState } from "react";
import type { CalcResult } from "@/lib/core/types";
import type { FullyLoadedCost } from "@/lib/finance/headcount";
import { fmtMoney, fmtPercent } from "@/lib/ui/format";
import { KeyValue } from "@/components/ui/KeyValue";
import { Notice } from "@/components/ui/Notice";
import { StatusPill } from "@/components/ui/Badge";

const RATE_FIELDS: { key: string; label: string; kind: "rate" | "base" }[] = [
  { key: "socialSecurityRate", label: "Social Security rate (employer)", kind: "rate" },
  { key: "socialSecurityWageBase", label: "Social Security wage base", kind: "base" },
  { key: "medicareRate", label: "Medicare rate (employer)", kind: "rate" },
  { key: "futaRate", label: "FUTA rate (effective)", kind: "rate" },
  { key: "futaWageBase", label: "FUTA wage base", kind: "base" },
  { key: "suiRate", label: "State UI rate", kind: "rate" },
  { key: "suiWageBase", label: "State UI wage base", kind: "base" },
  { key: "ettRate", label: "State training tax rate", kind: "rate" },
  { key: "sdiRate", label: "SDI rate (employee-paid, context only)", kind: "rate" },
];

export function EmployerCostCalculator({ canUse }: { canUse: boolean }) {
  const [amount, setAmount] = useState("96000");
  const [period, setPeriod] = useState<"ANNUAL" | "MONTHLY" | "HOURLY">("ANNUAL");
  const [hours, setHours] = useState("2080");
  const [benefits, setBenefits] = useState("");
  const [overhead, setOverhead] = useState("");
  const [rates, setRates] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ calc: CalcResult<FullyLoadedCost | null>; warning: string; provenance: Record<string, string>; currentRules: { key: string; status: string; parameters: Record<string, unknown> | null }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/payroll/employer-cost", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ amount, period, type: period === "HOURLY" ? "HOURLY" : "SALARY", hoursPerYear: Number(hours) || undefined, benefits: benefits || null, overhead: overhead || null, rates }) });
      const body = (await res.json()) as typeof result & { error?: { message: string } };
      if (!res.ok || !body?.calc) throw new Error(body?.error?.message ?? `Failed (${res.status})`);
      setResult(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const v = result?.calc.value ?? null;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <form onSubmit={run} className="space-y-3">
        <Notice tone="warn" title="Rates are not authoritative">
          Enter the employer payroll tax rates you want to model. They are treated as UNCONFIRMED assumptions unless they come from a CONFIRMED tax rule citing an authoritative source. Every employer rate and wage base is required — a missing input returns INSUFFICIENT_INFORMATION rather than a guess.
        </Notice>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <label className="text-[12px] text-muted">
            Gross compensation
            <input value={amount} onChange={(e) => setAmount(e.target.value)} className="input mt-1" inputMode="decimal" />
          </label>
          <label className="text-[12px] text-muted">
            Period
            <select value={period} onChange={(e) => setPeriod(e.target.value as typeof period)} className="select mt-1">
              <option value="ANNUAL">Annual</option>
              <option value="MONTHLY">Monthly</option>
              <option value="HOURLY">Hourly</option>
            </select>
          </label>
          {period === "HOURLY" ? (
            <label className="text-[12px] text-muted">
              Hours / year
              <input value={hours} onChange={(e) => setHours(e.target.value)} className="input mt-1" inputMode="numeric" />
            </label>
          ) : null}
          <label className="text-[12px] text-muted">
            Benefits / year (blank = unknown)
            <input value={benefits} onChange={(e) => setBenefits(e.target.value)} className="input mt-1" inputMode="decimal" />
          </label>
          <label className="text-[12px] text-muted">
            Overhead / year (blank = unknown)
            <input value={overhead} onChange={(e) => setOverhead(e.target.value)} className="input mt-1" inputMode="decimal" />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {RATE_FIELDS.map((f) => (
            <label key={f.key} className="text-[12px] text-muted">
              {f.label}
              <input value={rates[f.key] ?? ""} onChange={(e) => setRates((r) => ({ ...r, [f.key]: e.target.value }))} placeholder={f.kind === "rate" ? "e.g. 0.062" : "e.g. 176100"} className="input mt-1" inputMode="decimal" />
            </label>
          ))}
        </div>
        <button type="submit" disabled={busy || !canUse} className="inline-flex h-8 items-center rounded-md border border-accent bg-accent px-3 text-[13px] font-medium text-accent-fg disabled:opacity-50">
          {busy ? "Calculating…" : "Calculate employer cost"}
        </button>
        {error ? <p className="text-[12px] text-bad">{error}</p> : null}
      </form>
      <div>
        {!result ? (
          <div className="rounded-md border border-dashed border-line-strong p-6 text-center text-[13px] text-muted">Results appear here with the formula and every input.</div>
        ) : v === null ? (
          <Notice tone="bad" title="Insufficient information">
            {result.calc.notes?.join(" ") ?? "The calculation could not be completed with the inputs provided."}
            <div className="mt-1 text-[11px]">Assumptions: {result.calc.assumptions.map((a) => `${a.key}=${String(a.value)} [${a.status}]`).join("; ")}</div>
          </Notice>
        ) : (
          <div className="space-y-3">
            <KeyValue
              items={[
                { k: "Annual gross", v: fmtMoney(v.annualGrossWages) },
                { k: "Social Security", v: fmtMoney(v.socialSecurity) },
                { k: "Medicare", v: fmtMoney(v.medicare) },
                { k: "FUTA", v: fmtMoney(v.futa) },
                { k: "State UI", v: fmtMoney(v.sui) },
                { k: "Training tax", v: fmtMoney(v.ett) },
                { k: "Employer taxes", v: <strong>{fmtMoney(v.employerTaxes)}</strong> },
                { k: "Effective rate", v: fmtPercent(v.employerTaxRate, 2) },
                { k: "Wages + taxes", v: fmtMoney(v.wagesPlusEmployerTaxes) },
                { k: "Benefits", v: v.benefits === null ? "unknown" : fmtMoney(v.benefits) },
                { k: "Overhead", v: v.overhead === null ? "unknown" : fmtMoney(v.overhead) },
                { k: "Fully loaded", v: v.total === null ? <span className="text-warn">unknown — benefits/overhead not provided</span> : <strong>{fmtMoney(v.total)}</strong> },
              ]}
            />
            <Notice tone="warn">{result.warning}</Notice>
            <details className="text-[12px]">
              <summary className="cursor-pointer text-muted">Workpaper: formula, assumptions, rule store</summary>
              <p className="mono mt-1 whitespace-pre-wrap">{result.calc.formula}</p>
              <ul className="mt-2 space-y-0.5">
                {result.calc.assumptions.map((a) => (
                  <li key={a.key} className="flex flex-wrap items-center gap-1.5">
                    <StatusPill status={a.status} />
                    <span className="mono">{a.key}</span> = {String(a.value)}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-muted">Rule store CURRENT rules: {result.currentRules.length === 0 ? "none — every payroll tax rule is PENDING_RETRIEVAL or needs review" : result.currentRules.map((r) => r.key).join(", ")}</p>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}
