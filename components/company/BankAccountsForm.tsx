"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export interface GlOption {
  id: string;
  code: string;
  name: string;
}

/** "Bank accounts & cards" form → POST /api/company/accounts. Stores last4 only; never a full number. */
export function BankAccountsForm({ bankGl, cardGl, canEnter }: { bankGl: GlOption[]; cardGl: GlOption[]; canEnter: boolean }) {
  const router = useRouter();
  const [kind, setKind] = useState<"BANK" | "CARD">("BANK");
  const [name, setName] = useState("");
  const [institution, setInstitution] = useState("");
  const [accountType, setAccountType] = useState<"CHECKING" | "SAVINGS" | "MONEY_MARKET">("CHECKING");
  const [last4, setLast4] = useState("");
  const [glAccountId, setGl] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const glOptions = kind === "BANK" ? bankGl : cardGl;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/company/accounts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, name, institution, accountType: kind === "BANK" ? accountType : undefined, last4, glAccountId: glAccountId || undefined }) });
      const body = (await res.json()) as { message?: string; error?: { message: string } };
      if (!res.ok) throw new Error(body.error?.message ?? `Failed (${res.status})`);
      setMsg({ ok: true, text: body.message ?? "Registered." });
      setName("");
      setInstitution("");
      setLast4("");
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Failed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-2 rounded-md border border-line bg-surface-2 p-3">
      <div className="text-[12px] text-muted">Register a business bank account or card. Enter only the <strong>last four digits</strong> — full account or card numbers are never accepted or stored. Registering one marks the matching finance-bible field CONFIRMED and creates an audit event. No connection to the institution is made.</div>
      <div className="grid gap-2 sm:grid-cols-[auto_1fr_1fr]">
        <select value={kind} onChange={(e) => { setKind(e.target.value as "BANK" | "CARD"); setGl(""); }} className="select" disabled={!canEnter}>
          <option value="BANK">Bank account</option>
          <option value="CARD">Card</option>
        </select>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === "BANK" ? "Nickname (e.g. Operating Checking)" : "Nickname (e.g. Business Visa)"} className="input" disabled={!canEnter} required />
        <input value={institution} onChange={(e) => setInstitution(e.target.value)} placeholder={kind === "BANK" ? "Bank / institution" : "Issuer"} className="input" disabled={!canEnter} required />
      </div>
      <div className="grid gap-2 sm:grid-cols-[auto_auto_1fr]">
        {kind === "BANK" ? (
          <select value={accountType} onChange={(e) => setAccountType(e.target.value as typeof accountType)} className="select" disabled={!canEnter}>
            <option value="CHECKING">Checking</option>
            <option value="SAVINGS">Savings</option>
            <option value="MONEY_MARKET">Money market</option>
          </select>
        ) : (
          <span className="self-center text-[12px] text-muted">Liability card</span>
        )}
        <input value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="Last 4 digits" inputMode="numeric" pattern="\d{4}" maxLength={4} className="input w-32" disabled={!canEnter} required />
        <select value={glAccountId} onChange={(e) => setGl(e.target.value)} className="select" disabled={!canEnter}>
          <option value="">GL account: default ({kind === "BANK" ? (accountType === "CHECKING" ? "1000 Operating Checking" : "1010 Business Savings / Reserve") : "2050 Business Credit Card"})</option>
          {glOptions.map((g) => (
            <option key={g.id} value={g.id}>
              {g.code} · {g.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className={`text-[12px] ${msg ? (msg.ok ? "text-ok" : "text-bad") : "text-faint"}`}>{msg ? msg.text : canEnter ? "Each account maps to one GL cash / card account so balances stay separable." : "Only OWNER or FINANCE_OPERATOR can register accounts."}</div>
        <button type="submit" disabled={busy || !canEnter || last4.length !== 4} className="inline-flex h-8 items-center rounded-md border border-accent bg-accent px-3 text-[13px] font-medium text-accent-fg disabled:opacity-50">
          {busy ? "Saving…" : kind === "BANK" ? "Register bank account" : "Register card"}
        </button>
      </div>
    </form>
  );
}
