"use client";
import { useState } from "react";
import { Markdown } from "@/components/ui/Markdown";
import { Notice } from "@/components/ui/Notice";
import { pretty } from "@/lib/ui/serialize";

export function CpaPackagePanel({ from, to }: { from: string; to: string }) {
  const [busy, setBusy] = useState(false);
  const [md, setMd] = useState<string | null>(null);
  const [pkg, setPkg] = useState<Record<string, unknown> | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/reports/cpa-package", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ from, to }) });
      const body = (await res.json()) as { package?: Record<string, unknown>; markdown?: string | null; error?: { message: string } };
      if (!res.ok) throw new Error(body.error?.message ?? `Failed (${res.status})`);
      setPkg(body.package ?? null);
      setMd(body.markdown ?? null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const sections = pkg && Array.isArray(pkg.sections) ? (pkg.sections as { title?: string; body?: string }[]) : [];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => void run()} disabled={busy} className="inline-flex h-8 items-center rounded-md border border-accent bg-accent px-3 text-[13px] font-medium text-accent-fg disabled:opacity-50">
          {busy ? "Building…" : `Generate CPA package (${from} → ${to})`}
        </button>
        <span className="text-[12px] text-muted">Trial balance, statements, GL detail, open items, fixed assets, payroll summary, unknowns and CPA questions — every number with a calc id.</span>
      </div>
      {err ? (
        <Notice tone={/not yet available/i.test(err) ? "warn" : "bad"} title={/not yet available/i.test(err) ? "Subsystem not available yet" : "Package failed"}>
          {err}
        </Notice>
      ) : null}
      {md ? (
        <div className="rounded-lg border border-line bg-surface p-4">
          <Markdown text={md} />
        </div>
      ) : pkg ? (
        <div className="space-y-3">
          {sections.map((s, i) => (
            <div key={i} className="rounded-lg border border-line bg-surface p-4">
              <h3 className="text-[14px] font-semibold">{s.title ?? `Section ${i + 1}`}</h3>
              {s.body ? <Markdown text={s.body} /> : null}
            </div>
          ))}
          <details>
            <summary className="cursor-pointer text-[12px] text-muted">Raw package JSON</summary>
            <pre className="mono max-h-96 overflow-auto whitespace-pre-wrap text-[11px]">{pretty(pkg)}</pre>
          </details>
        </div>
      ) : null}
    </div>
  );
}
