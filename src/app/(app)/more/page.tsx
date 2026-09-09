import Link from "next/link";
import { signOut } from "@/lib/actions/auth";
import { requireViewer } from "@/lib/actions/helpers";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "More" };

export default async function MorePage() {
  const viewer = await requireViewer();
  const others = viewer.spaces.filter((s) => s.kind === "personal" && s.personId !== viewer.person?.id);
  const links = [
    ...others.map((s) => ({ href: `/personal/${s.id}`, label: `${s.name}'s personal space` })),
    { href: "/transactions", label: "Transactions" },
    { href: "/accounts", label: "Accounts, bills & goals" },
    { href: "/scenarios", label: "Scenarios" },
    { href: "/assistant", label: "Assistant" },
    { href: "/settings", label: "Settings" },
  ];
  return (
    <>
      <PageHeader title="More" description={`${viewer.user.name} · ${viewer.workspace.name}`} />
      <ul className="card divide-y divide-line">
        {links.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="flex items-center justify-between px-4 py-3.5 text-[15px] hover:bg-surface-2">
              {l.label}
              <span aria-hidden className="text-ink-3">›</span>
            </Link>
          </li>
        ))}
        <li>
          <form action={signOut}>
            <button className="w-full px-4 py-3.5 text-left text-[15px] text-bad hover:bg-surface-2">Sign out</button>
          </form>
        </li>
      </ul>
    </>
  );
}
