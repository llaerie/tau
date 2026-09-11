import Link from "next/link";
import { getActor } from "@/lib/ui/session";
import { resolveAuthMode } from "@/lib/security/auth-mode";
import { Badge } from "@/components/ui/Badge";
import { LogoutButton } from "@/components/auth/AccountForms";

/**
 * Server component: who is signed in, with a role chip and a sign-out button (full mode)
 * or a shortcut to the lab role switcher (lab mode).
 */
export async function UserMenu() {
  const actor = await getActor();
  const full = resolveAuthMode() === "full";
  return (
    <div className="-mt-1 mb-3 flex flex-wrap items-center justify-end gap-2 text-[12px] text-muted" aria-label="Current user">
      <span className="truncate font-medium text-fg">{actor.displayName ?? actor.id}</span>
      <Badge tone={actor.role === "OWNER" ? "accent" : "info"}>{actor.role.replace(/_/g, " ")}</Badge>
      {full ? (
        <LogoutButton size="sm" />
      ) : (
        <Link href="/settings?tab=session" className="inline-flex h-7 items-center rounded-md border border-line-strong bg-surface px-2.5 text-[12px] font-medium hover:bg-surface-2">
          Lab session · switch role
        </Link>
      )}
    </div>
  );
}
