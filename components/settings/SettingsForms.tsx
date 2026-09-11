"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Notice } from "@/components/ui/Notice";

async function post(url: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message: string } };
  if (!res.ok) throw new Error(data.error?.message ?? `Failed (${res.status})`);
  return data;
}

export function RoleSwitcher({ current, roles, labMode }: { current: string; roles: string[]; labMode: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function switchTo(role: string) {
    setBusy(role);
    setMsg(null);
    try {
      const d = await post("/api/settings/session", { role });
      setMsg({ ok: true, text: String(d.message ?? "Switched") });
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Failed" });
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {roles.map((r) => (
          <button key={r} onClick={() => void switchTo(r)} disabled={!labMode || busy !== null} className={`inline-flex h-8 items-center rounded-md border px-3 text-[13px] font-medium disabled:opacity-50 ${r === current ? "border-accent bg-accent-soft text-accent" : "border-line-strong bg-surface hover:bg-surface-2"}`}>
            {busy === r ? "…" : r.replace(/_/g, " ")}
          </button>
        ))}
      </div>
      {msg ? <div className={`text-[12px] ${msg.ok ? "text-ok" : "text-bad"}`}>{msg.text}</div> : null}
    </div>
  );
}

export function ProviderWizard({ options, choices, canEdit }: { options: { key: string; vendor: string; kind: string; description: string }[]; choices: Record<string, string | null>; canEdit: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const kinds: { kind: string; label: string }[] = [
    { kind: "ACCOUNTING", label: "Accounting system" },
    { kind: "PAYROLL", label: "Payroll provider" },
    { kind: "BANK_DATA", label: "Bank data" },
    { kind: "DOCUMENT", label: "Document storage" },
    { kind: "INTERNATIONAL_WORKFORCE", label: "International workforce" },
  ];
  async function choose(kind: string, providerKey: string) {
    setBusy(`${kind}:${providerKey}`);
    setMsg(null);
    try {
      const d = await post("/api/settings/providers", { kind, providerKey });
      setMsg({ ok: true, text: String(d.message) });
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Failed" });
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="space-y-4">
      {kinds.map((k) => (
        <div key={k.kind}>
          <div className="mb-1.5 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-muted">
            {k.label}
            {choices[k.kind] ? <span className="rounded bg-warn-soft px-1.5 text-[11px] normal-case tracking-normal text-warn">chosen: {options.find((o) => o.key === choices[k.kind])?.vendor ?? choices[k.kind]} · UNCONFIRMED · not connected</span> : <span className="rounded bg-surface-2 px-1.5 text-[11px] normal-case tracking-normal">no choice recorded</span>}
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {options
              .filter((o) => o.kind === k.kind)
              .map((o) => (
                <button key={o.key} onClick={() => void choose(k.kind, o.key)} disabled={!canEdit || busy !== null} className={`rounded-md border p-3 text-left text-[13px] hover:bg-surface-2 disabled:opacity-60 ${choices[k.kind] === o.key ? "border-accent bg-accent-soft/40" : "border-line bg-surface"}`}>
                  <div className="font-medium">{o.vendor}</div>
                  <div className="text-[12px] text-muted">{o.description}</div>
                  <div className="mt-1 text-[11px] text-faint">{busy === `${k.kind}:${o.key}` ? "Recording…" : "Records a choice only — no live account is created"}</div>
                </button>
              ))}
          </div>
        </div>
      ))}
      {msg ? <div className={`text-[12px] ${msg.ok ? "text-ok" : "text-bad"}`}>{msg.text}</div> : null}
    </div>
  );
}

export function MaterialityForm({ current, canEdit }: { current: Record<string, string | number | null>; canEdit: boolean }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(Object.fromEntries(Object.entries(current).map(([k, v]) => [k, v === null || v === undefined ? "" : String(v)])));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fields: { key: string; label: string; hint: string }[] = [
    { key: "transactionReviewAmount", label: "Transaction review amount", hint: "Single amount above which an action is at least YELLOW" },
    { key: "redAmount", label: "Red amount", hint: "Single amount above which any action is RED" },
    { key: "forecastChangeAmount", label: "Material forecast change ($)", hint: "Absolute forecast change considered material" },
    { key: "forecastChangeRatio", label: "Material forecast change (ratio)", hint: "0.10 = 10%" },
    { key: "varianceRatio", label: "Material budget variance (ratio)", hint: "0.10 = 10%" },
    { key: "minimumCashReserve", label: "Minimum cash reserve", hint: "Leave blank if the company has no policy (stays unknown)" },
  ];
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const d = await post("/api/settings/materiality", { values });
      setMsg({ ok: true, text: String(d.message) });
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Failed" });
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map((f) => (
          <label key={f.key} className="text-[12px] text-muted">
            {f.label}
            <input value={values[f.key] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} className="input mt-1" inputMode="decimal" disabled={!canEdit} />
            <span className="text-[11px] text-faint">{f.hint}</span>
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy || !canEdit} className="inline-flex h-8 items-center rounded-md border border-accent bg-accent px-3 text-[13px] font-medium text-accent-fg disabled:opacity-50">
          {busy ? "Saving…" : "Confirm thresholds"}
        </button>
        {msg ? <span className={`text-[12px] ${msg.ok ? "text-ok" : "text-bad"}`}>{msg.text}</span> : null}
      </div>
    </form>
  );
}

export function ResetLab({ canReset }: { canReset: boolean }) {
  const router = useRouter();
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function reset() {
    if (!window.confirm("Regenerate the synthetic company and discard the lab snapshot? Audit history from this session will be replaced.")) return;
    setBusy(true);
    setMsg(null);
    try {
      const d = await post("/api/lab/reset", { confirm: phrase });
      setMsg({ ok: true, text: String(d.message) });
      setPhrase("");
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Failed" });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2">
      <Notice tone="bad" title="Destructive">
        Resets the in-memory store and the .tau snapshot to a freshly generated synthetic company. Type <span className="mono">RESET LAB</span> to enable the button.
      </Notice>
      <div className="flex flex-wrap items-center gap-2">
        <input value={phrase} onChange={(e) => setPhrase(e.target.value)} placeholder="RESET LAB" className="input max-w-xs" disabled={!canReset} />
        <button onClick={() => void reset()} disabled={busy || !canReset || phrase !== "RESET LAB"} className="inline-flex h-8 items-center rounded-md border border-bad/50 bg-surface px-3 text-[13px] font-medium text-bad hover:bg-bad-soft disabled:opacity-50">
          {busy ? "Resetting…" : "Reset lab data"}
        </button>
      </div>
      {msg ? <div className={`text-[12px] ${msg.ok ? "text-ok" : "text-bad"}`}>{msg.text}</div> : null}
      {!canReset ? <div className="text-[11px] text-bad">Only the OWNER role can reset the lab.</div> : null}
    </div>
  );
}
