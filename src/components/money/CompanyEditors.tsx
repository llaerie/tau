"use client";

import { useState } from "react";
import type { PurchasePlan, Subscription } from "@/lib/db/schema";
import { ActionFlowCard, useDraftAction } from "./ActionFlow";

function toCents(v: string): number | null {
  const n = Number(v.replace(/[$,\s]/g, ""));
  if (!v.trim() || !Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export function SubscriptionConfirm({ sub, editable }: { sub: Subscription; editable: boolean }) {
  const [open, setOpen] = useState(false);
  const [tier, setTier] = useState(sub.tier ?? "");
  const [price, setPrice] = useState(sub.unitPriceCents === null ? "" : (sub.unitPriceCents / 100).toFixed(2));
  const [quantity, setQuantity] = useState(String(sub.quantity));
  const [status, setStatus] = useState(sub.status);
  const [interval, setInterval] = useState(sub.interval);
  const flow = useDraftAction(`sub-${sub.id}`);
  if (!editable) return null;
  return (
    <div>
      {!open && !flow.action && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)} data-testid={`confirm-sub-${sub.id}`}>
          {sub.tier && sub.unitPriceCents !== null ? "Edit" : "Confirm tier & price"}
        </button>
      )}
      {open && !flow.action && (
        <form
          className="mt-2 grid gap-2 sm:grid-cols-5 sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            flow.draft("subscription_change", { id: sub.id, provider: sub.provider, product: sub.product, tier: tier.trim() || null, kind: sub.kind, quantity: Math.max(1, Number(quantity) || 1), unitPriceCents: toCents(price), interval, status, accountStatus: sub.accountStatus });
            setOpen(false);
          }}
        >
          <label className="text-sm"><span className="label">Tier</span><input className="input mt-1" value={tier} onChange={(e) => setTier(e.target.value)} placeholder="e.g. Max 5x" /></label>
          <label className="text-sm"><span className="label">Unit price</span><input className="input mt-1" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Unknown" /></label>
          <label className="text-sm"><span className="label">Seats</span><input className="input mt-1" inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></label>
          <label className="text-sm"><span className="label">Billing</span>
            <select className="input mt-1" value={interval} onChange={(e) => setInterval(e.target.value as typeof interval)}><option value="monthly">Monthly</option><option value="annual">Annual</option></select>
          </label>
          <label className="text-sm"><span className="label">Status</span>
            <select className="input mt-1" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}><option value="planned">Planned</option><option value="active">Active</option><option value="cancelled">Cancelled</option></select>
          </label>
          <div className="flex gap-2 sm:col-span-5">
            <button className="btn btn-primary btn-sm" disabled={flow.busy}>Preview change</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Cancel</button>
            <span className="self-center text-[12px] text-ink-3">Records what you pay; nothing is purchased or cancelled with the provider.</span>
          </div>
        </form>
      )}
      {flow.error && <p className="mt-2 text-[13px] text-bad">{flow.error}</p>}
      {flow.action && <ActionFlowCard action={flow.action} onChange={flow.onChange} onDone={flow.clear} />}
    </div>
  );
}

export function PurchasePlanEditor({ payerSpaceId, persons, editable, existing }: { payerSpaceId: string; persons: { id: string; name: string }[]; editable: boolean; existing?: PurchasePlan }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(existing?.name ?? "");
  const [category, setCategory] = useState<"hardware" | "furniture" | "software" | "travel" | "other">(existing?.category ?? "hardware");
  const [price, setPrice] = useState(existing?.unitPriceCents === null || existing?.unitPriceCents === undefined ? "" : (existing.unitPriceCents / 100).toFixed(2));
  const [quantity, setQuantity] = useState(String(existing?.quantity ?? 1));
  const [month, setMonth] = useState(existing?.targetMonth ?? "");
  const [beneficiary, setBeneficiary] = useState<"company" | "household" | "person" | "split">(existing?.beneficiary ?? "company");
  const [beneficiaryPersonId, setBeneficiaryPersonId] = useState(existing?.beneficiaryPersonId ?? persons[0]?.id ?? "");
  const [purpose, setPurpose] = useState<"business" | "personal" | "mixed" | "unresolved">(existing?.purpose ?? "unresolved");
  const flow = useDraftAction(existing ? `plan-${existing.id}` : "plan-new");
  const archive = useDraftAction(existing ? `plan-archive-${existing.id}` : "plan-archive");
  if (!editable) return null;
  return (
    <div>
      {!open && !flow.action && !archive.action && (
        <div className="flex gap-2">
          <button type="button" className={`btn ${existing ? "btn-ghost" : "btn-secondary"} btn-sm`} onClick={() => setOpen(true)} data-testid={existing ? `edit-plan-${existing.id}` : "add-purchase-plan"}>
            {existing ? "Edit" : "Plan a purchase"}
          </button>
          {existing && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => archive.draft("archive_record", { entity: "purchase_plan", id: existing.id })}>
              Archive
            </button>
          )}
        </div>
      )}
      {open && !flow.action && (
        <form
          className="mt-2 grid gap-2 sm:grid-cols-3 sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            flow.draft("purchase_plan", { ...(existing ? { id: existing.id } : {}), name: name.trim(), category, unitPriceCents: toCents(price), quantity: Math.max(1, Number(quantity) || 1), targetMonth: month || null, payerSpaceId, beneficiary, beneficiaryPersonId: beneficiary === "person" ? beneficiaryPersonId : null, purpose });
            setOpen(false);
          }}
        >
          <label className="text-sm sm:col-span-2"><span className="label">What</span><input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mac mini (2026)" required data-testid="plan-name" /></label>
          <label className="text-sm"><span className="label">Category</span>
            <select className="input mt-1" value={category} onChange={(e) => setCategory(e.target.value as typeof category)}>
              <option value="hardware">Hardware</option><option value="furniture">Furniture</option><option value="software">Software</option><option value="travel">Travel</option><option value="other">Other</option>
            </select>
          </label>
          <label className="text-sm"><span className="label">Unit price (blank = unknown)</span><input className="input mt-1" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Unknown" data-testid="plan-price" /></label>
          <label className="text-sm"><span className="label">Quantity</span><input className="input mt-1" inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></label>
          <label className="text-sm"><span className="label">Target month</span><input className="input mt-1" type="month" value={month} onChange={(e) => setMonth(e.target.value)} data-testid="plan-month" /></label>
          <label className="text-sm"><span className="label">Who benefits</span>
            <select className="input mt-1" value={beneficiary} onChange={(e) => setBeneficiary(e.target.value as typeof beneficiary)}>
              <option value="company">Company</option><option value="household">Household</option><option value="person">One person</option><option value="split">Split</option>
            </select>
          </label>
          {beneficiary === "person" && (
            <label className="text-sm"><span className="label">Person</span>
              <select className="input mt-1" value={beneficiaryPersonId} onChange={(e) => setBeneficiaryPersonId(e.target.value)}>
                {persons.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          )}
          <label className="text-sm"><span className="label">Purpose</span>
            <select className="input mt-1" value={purpose} onChange={(e) => setPurpose(e.target.value as typeof purpose)}>
              <option value="unresolved">Not decided yet</option><option value="business">Business</option><option value="personal">Personal</option><option value="mixed">Mixed</option>
            </select>
          </label>
          <div className="flex gap-2 sm:col-span-3">
            <button className="btn btn-primary btn-sm" disabled={flow.busy || !name.trim()} data-testid="plan-preview">Preview plan</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Cancel</button>
            <span className="self-center text-[12px] text-ink-3">A dated plan, not a payment.</span>
          </div>
        </form>
      )}
      {flow.error && <p className="mt-2 text-[13px] text-bad">{flow.error}</p>}
      {flow.action && <ActionFlowCard action={flow.action} onChange={flow.onChange} onDone={flow.clear} />}
      {archive.error && <p className="mt-2 text-[13px] text-bad">{archive.error}</p>}
      {archive.action && <ActionFlowCard action={archive.action} onChange={archive.onChange} onDone={archive.clear} />}
    </div>
  );
}
