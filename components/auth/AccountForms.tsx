"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

async function post(url: string, body?: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message: string } };
  if (!res.ok) throw new Error(data.error?.message ?? `Failed (${res.status})`);
  return data;
}

export function LogoutButton({ size = "md", className = "" }: { size?: "sm" | "md"; className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function logout() {
    setBusy(true);
    try {
      await post("/api/auth/logout");
      router.replace("/login");
      router.refresh();
    } catch {
      setBusy(false);
    }
  }
  const cls = size === "sm" ? "h-7 px-2.5 text-[12px]" : "h-8 px-3 text-[13px]";
  return (
    <button type="button" onClick={() => void logout()} disabled={busy} className={`inline-flex items-center rounded-md border border-line-strong bg-surface font-medium hover:bg-surface-2 disabled:opacity-50 ${cls} ${className}`}>
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}

export function ChangePasswordForm({ minLength }: { minLength: number }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (next !== confirm) {
      setMsg({ ok: false, text: "New password and confirmation do not match" });
      return;
    }
    setBusy(true);
    try {
      const d = await post("/api/auth/change-password", { currentPassword: current, newPassword: next });
      setMsg({ ok: true, text: String(d.message ?? "Password updated") });
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Failed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-[12px] text-muted">
          Current password
          <input type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} className="input mt-1" disabled={busy} />
        </label>
        <label className="text-[12px] text-muted">
          New password
          <input type="password" autoComplete="new-password" required minLength={minLength} value={next} onChange={(e) => setNext(e.target.value)} className="input mt-1" disabled={busy} />
          <span className="text-[11px] text-faint">At least {minLength} characters</span>
        </label>
        <label className="text-[12px] text-muted">
          Confirm new password
          <input type="password" autoComplete="new-password" required minLength={minLength} value={confirm} onChange={(e) => setConfirm(e.target.value)} className="input mt-1" disabled={busy} />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy || !current || !next || !confirm} className="inline-flex h-8 items-center rounded-md border border-accent bg-accent px-3 text-[13px] font-medium text-accent-fg disabled:opacity-50">
          {busy ? "Updating…" : "Change password"}
        </button>
        {msg ? <span className={`text-[12px] ${msg.ok ? "text-ok" : "text-bad"}`}>{msg.text}</span> : null}
      </div>
    </form>
  );
}
