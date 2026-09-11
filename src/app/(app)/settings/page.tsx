import { and, eq, isNull } from "drizzle-orm";
import { ModeBadge } from "@/components/AppShell";
import { CompanyAssumptionsForm, OwnerAssumptionsForm } from "@/components/forms/AssumptionsForms";
import { InviteForm, RenameWorkspaceForm, ResetDemoButton, RoleSelect, RevokeInviteButton, SignOutButton } from "@/components/forms/SettingsForms";
import { Card, Notice, PageHeader, Section } from "@/components/ui";
import { requireViewer } from "@/lib/actions/helpers";
import { canEditAssumptions } from "@/lib/auth/authorize";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db";
import * as s from "@/lib/db/schema";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const viewer = await requireViewer();
  const config = getConfig();
  const db = getDb();
  const isOwner = viewer.workspaceRole === "owner";
  const members = db
    .select({ user: s.users, role: s.memberships.role })
    .from(s.memberships)
    .innerJoin(s.users, eq(s.users.id, s.memberships.userId))
    .where(eq(s.memberships.workspaceId, viewer.workspace.id))
    .all();
  const allSpaces = db.select().from(s.spaces).where(eq(s.spaces.workspaceId, viewer.workspace.id)).all();
  const sharedSpaces = allSpaces.filter((sp) => sp.kind !== "personal");
  const perms = db.select().from(s.spacePermissions).all().filter((p) => allSpaces.some((sp) => sp.id === p.spaceId));
  const invites = isOwner ? db.select().from(s.invites).where(and(eq(s.invites.workspaceId, viewer.workspace.id), isNull(s.invites.acceptedByUserId))).all() : [];

  return (
    <>
      <PageHeader eyebrow="Workspace" title="Settings" description={viewer.workspace.name} actions={<SignOutButton />} />

      <Section title="Mode & data">
        <Card>
          <div className="flex flex-wrap items-center gap-3">
            <ModeBadge isDemo={viewer.isDemo} />
            <p className="text-sm text-ink-2">
              {config.mode === "demo"
                ? "Synthetic data in a local SQLite file. Persona sign-in, no passwords. Live mode needs FINANCE_DESK_MODE=live and AUTH_SECRET."
                : "Real data. Password accounts, signed sessions, per-space roles enforced on the server, private SQLite storage."}
            </p>
          </div>
          <p className="mt-3 text-sm text-ink-2">Assistant: {config.anthropicApiKey ? `Claude connected (${config.model})` : "no model connected; deterministic previews only"}.</p>
          <p className="mt-1 text-sm text-ink-2">Integrations: none. Bank, payroll and accounting systems are not connected; data arrives by manual entry or CSV import.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a className="btn btn-secondary btn-sm" href="/api/export">Export my visible data (JSON)</a>
            {viewer.isDemo && <ResetDemoButton />}
          </div>
        </Card>
      </Section>

      <Section title="Company assumptions" id="company" description="The figures every company number is derived from.">
        <Card>
          {isOwner && <div className="mb-5 border-b border-line pb-5"><RenameWorkspaceForm name={viewer.workspace.name} /></div>}
          {canEditAssumptions(viewer) ? <CompanyAssumptionsForm a={viewer.assumptions} /> : <Notice>You need edit access to the company space to change these.</Notice>}
        </Card>
      </Section>

      <Section title="People" id="people" description="Roles, gross salaries, withholding estimates and household contributions.">
        <div className="grid gap-3 lg:grid-cols-2">
          {viewer.persons.map((p) => (
            <Card key={p.id}>
              <OwnerAssumptionsForm personId={p.id} name={p.name} title={p.title} o={viewer.assumptions.owners[p.id]} editable={p.userId === viewer.user.id || isOwner} />
            </Card>
          ))}
        </div>
      </Section>

      <Section title="Members & permissions" description="Roles apply per space. Personal spaces are private to their person and cannot be shared here.">
        <Card className="!p-0">
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Member</th>
                  {sharedSpaces.map((sp) => <th key={sp.id}>{sp.name}</th>)}
                  <th>Personal</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => {
                  const person = viewer.persons.find((p) => p.userId === m.user.id);
                  return (
                    <tr key={m.user.id}>
                      <td>{m.user.name}<span className="block text-xs text-ink-3">{m.user.email} · workspace {m.role}</span></td>
                      {sharedSpaces.map((sp) => {
                        const role = perms.find((p) => p.spaceId === sp.id && p.userId === m.user.id)?.role ?? "none";
                        return <td key={sp.id}>{isOwner ? <RoleSelect userId={m.user.id} spaceId={sp.id} role={role} disabled={m.user.id === viewer.user.id} /> : <span className="chip chip-neutral">{role}</span>}</td>;
                      })}
                      <td className="text-sm text-ink-2">{person ? `${person.name}'s space (private)` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </Section>

      {isOwner && (
        <Section title="Invite links" description="Finance Desk does not send email. Create a link and share it yourself; it expires in seven days.">
          <Card>
            <InviteForm spaces={sharedSpaces.map((sp) => ({ id: sp.id, name: sp.name }))} />
            {invites.length > 0 && (
              <ul className="mt-4 divide-y divide-line text-sm">
                {invites.map((inv) => (
                  <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>{inv.personName}<span className="block text-xs text-ink-3">expires {inv.expiresAt.slice(0, 10)}</span></span>
                    <code className="max-w-full truncate rounded bg-surface-3 px-2 py-1 text-xs">/sign-in?invite={inv.code}</code>
                    <RevokeInviteButton id={inv.id} />
                  </li>
                ))}
              </ul>
            )}
            {config.mode === "demo" && <p className="mt-3 text-xs text-ink-3">In demo mode invite links can be created but registration is disabled; they become usable in live mode.</p>}
          </Card>
        </Section>
      )}
    </>
  );
}
