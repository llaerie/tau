import { formatCents, isKnown, type Amount, type Total } from "@/lib/finance/money";

export function UnknownChip({ reason, short }: { reason?: string; short?: boolean }) {
  return (
    <span className="chip chip-unknown" title={reason}>
      {short ? "?" : "Not known"}
    </span>
  );
}

export function AmountText({ amount, cents, signed, className = "" }: { amount: Amount; cents?: boolean; signed?: boolean; className?: string }) {
  if (!isKnown(amount)) return <UnknownChip reason={amount.reason} />;
  return <span className={`fd-money ${className}`}>{formatCents(amount.cents, { cents, signed })}</span>;
}

/** A total: complete → plain figure; incomplete → "known so far" figure with an unknown marker. */
export function TotalText({ total, cents, className = "", size = "md" }: { total: Total; cents?: boolean; className?: string; size?: "sm" | "md" | "lg" }) {
  const sizeCls = size === "lg" ? "text-[38px] font-semibold leading-none tracking-tight" : size === "sm" ? "text-[14px] font-medium" : "text-[17px] font-semibold";
  if (total.complete) return <span className={`fd-money ${sizeCls} ${className}`}>{formatCents(total.knownCents, { cents })}</span>;
  if (total.knownCents === 0) {
    return (
      <span className={`inline-flex items-baseline gap-2 ${className}`}>
        <span className={`${sizeCls} text-ink-3`}>Not known</span>
        <span className="chip chip-unknown" title={total.unknowns.join("; ")}>{total.unknowns.length === 1 ? total.unknowns[0] : `${total.unknowns.length} items`}</span>
      </span>
    );
  }
  return (
    <span className={`inline-flex flex-wrap items-baseline gap-x-2 gap-y-1 ${className}`}>
      <span className={`fd-money ${sizeCls}`}>{formatCents(total.knownCents, { cents })}</span>
      <span className="chip chip-unknown" title={total.unknowns.join("; ")}>
        known so far · {total.unknowns.length} missing
      </span>
    </span>
  );
}

export function Cents({ value, signed, cents, className = "" }: { value: number; signed?: boolean; cents?: boolean; className?: string }) {
  return <span className={`fd-money ${className}`}>{formatCents(value, { signed, cents })}</span>;
}
