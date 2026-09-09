import { redirect } from "next/navigation";
import { AppShell, type NavItem } from "@/components/AppShell";
import { ConfigErrorScreen } from "@/components/ConfigErrorScreen";
import { getViewer } from "@/lib/auth/session";
import { safeConfig } from "@/lib/safe-config";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { error } = safeConfig();
  if (error) return <ConfigErrorScreen message={error} />;
  const viewer = await getViewer();
  if (!viewer) redirect("/sign-in");

  const mine = viewer.spaces.find((sp) => sp.kind === "personal" && sp.personId === viewer.person?.id);
  const otherPersonal = viewer.spaces.filter((sp) => sp.kind === "personal" && sp.id !== mine?.id);
  const items: NavItem[] = [
    { href: "/", label: "Overview", icon: "overview" },
    ...(viewer.spaces.some((s) => s.kind === "company") ? [{ href: "/company", label: "Company", icon: "company" as const }] : []),
    ...(viewer.spaces.some((s) => s.kind === "household") ? [{ href: "/household", label: "Household", icon: "household" as const }] : []),
    ...(mine ? [{ href: `/personal/${mine.id}`, label: `${mine.name} (me)`, short: "Me", icon: "person" as const }] : []),
    ...otherPersonal.map((sp) => ({ href: `/personal/${sp.id}`, label: sp.name, icon: "person" as const })),
    { href: "/transactions", label: "Transactions", icon: "ledger" },
    { href: "/accounts", label: "Accounts", icon: "accounts" },
    { href: "/scenarios", label: "Scenarios", icon: "scenarios" },
    { href: "/assistant", label: "Assistant", icon: "assistant" },
    { href: "/settings", label: "Settings", icon: "settings" },
  ];
  const mobileItems: NavItem[] = [
    items[0],
    ...items.filter((i) => i.href === "/company" || i.href === "/household").slice(0, 2),
    ...(mine ? [items.find((i) => i.href === `/personal/${mine.id}`)!] : [{ href: "/transactions", label: "Ledger", icon: "ledger" as const }]),
    { href: "/more", label: "More", icon: "more" },
  ];

  return (
    <AppShell items={items} mobileItems={mobileItems} workspaceName={viewer.workspace.name} userName={viewer.user.name} isDemo={viewer.isDemo}>
      {children}
    </AppShell>
  );
}
