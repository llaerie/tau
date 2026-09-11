import { AmountText } from "@/components/Money";
import type { AccountWithBalance } from "@/lib/data/spaces";

export function AccountsStrip({ accounts }: { accounts: AccountWithBalance[] }) {
  return (
    <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {accounts
        .filter((a) => !a.isArchived)
        .map((a) => (
          <li key={a.id} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface px-3 py-2 text-[13px]">
            <span className="min-w-0">
              <span className="block truncate font-medium">{a.name}</span>
              <span className="block text-xs text-ink-3">{a.type.replace("_", " ")}{a.institution ? ` · ${a.institution}` : ""}</span>
            </span>
            <AmountText amount={a.balance} className={a.type === "credit_card" ? "text-ink-2" : ""} />
          </li>
        ))}
    </ul>
  );
}
