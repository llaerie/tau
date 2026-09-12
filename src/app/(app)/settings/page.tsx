import { and, eq, isNull } from "drizzle-orm";
import { ModeBadge } from "@/components/AppShell";
import { InviteForm, RenameWorkspaceForm, ResetDemoButton, RoleSelect, RevokeInviteButton, SignOutButton } from "@/components/forms/SettingsForms";
import { ArchiveRecordButton, CompanyForm, PayrollForm } from "@/components/settings/PlanForms";
import { ThemePicker, Toggle } from "@/components/settings/Preferences";
import { SettingsTabs, type SettingsGroup } from "@/components/settings/SettingsTabs";
import { Card, Notice, PageHeader, Section } from "@/components/ui";
import { requireViewer } from "@/lib/actions/helpers";
import { canEdit, canEditAssumptions } from "@/lib/auth/authorize";
import { getConfig } from "@/lib/config";
import { loadPreferences, loadSpaceData } from "@/lib/data/spaces";
import { getDb } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { formatCents } from "@/lib/finance/money";
import { reviewItems } from "@/lib/assumptions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const viewer = await requireViewer();
  const config = getConfig();
  const db = getDb();
  const prefs = loadPreferences(viewer.user.id);
  const isOwner = viewer.workspaceRole === "owner";
  const members = db.select({ user: s.users, role: s.memberships.role }).from(s.memberships).innerJoin(s.users, eq(s.users.id, s.memberships.userId)).where(eq(s.memberships.workspaceId, viewer.workspace.id)).all();
  const allSpaces = db.select().from(s.spaces).where(eq(s.spaces.workspaceId, viewer.workspace.id)).all();
  const sharedSpaces = allSpaces.filter((sp) => sp.kind !== "personal");
  const perms = db.select().from(s.spacePermissions).all().filter((p) => allSpaces.some((sp) => sp.id === p.spaceId));
  const invites = isOwner ? db.select().from(s.invites).where(and(eq(s.invites.workspaceId, viewer.workspace.id), isNull(s.invites.acceptedByUserId))).all() : [];
  const history = db.select().from(s.assumptionHistory).where(eq(s.assumptionHistory.workspaceId, viewer.workspace.id)).orderBy(s.assumptionHistory.effectiveFrom).all();
  const mine = viewer.spaces.find((sp) => sp.kind === "personal" && sp.personId === viewer.person?.id);
  const partner = viewer.persons.find((p) => p.id !== viewer.person?.id);
  const visible = viewer.spaces.filter((sp) => sp.kind !== "personal" || sp.id === mine?.id);
  const planRecords = visible.flatMap((sp) => {
    const d = loadSpaceData(viewer, sp);
    return [...d.goals.map((g) => ({ entity: "goal" as const, id: g.id, label: g.name, amount: g.monthlyTargetCents, source: g.source, space: sp })), ...d.budgets.map((b) => ({ entity: "budget" as const, id: b.id, label: b.name, amount: b.monthlyCents, source: b.source, space: sp }))];
  });
  const items = reviewItems(viewer.assumptions, { personId: viewer.person?.id ?? null, personNames: Object.fromEntries(viewer.persons.map((p) => [p.id, p.name])), visiblePersonIds: viewer.persons.map((p) => p.id), canSeeCompany: viewer.spaces.some((sp) => sp.kind === "company") });

  const groups: SettingsGroup[] = [
    {
      id: "you",
      label: "You",
      summary: "Who you are here, what your partner can see, and how the interface looks.",
      content: (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
          <Section title="Profile & privacy" id="privacy">
            <Card>
              <p className="text-[14px]">{viewer.user.name} · {viewer.user.email}{viewer.person?.title ? ` · ${viewer.person.title}` : ""}</p>
              <p className="mt-1 text-[12.5px] text-ink-3">Your personal space is private. The server never returns its rows, files or assistant context to anyone else.</p>
              <div className="mt-4 border-t border-line pt-4">
                <Toggle field="sharePersonalSummary" initial={prefs.sharePersonalSummary} label={`Share a coarse monthly summary with ${partner?.name ?? "your partner"}`} description="Only: food target set or not, on-track status, take-home status, and savings allocations rounded to $50. Never merchants, dates, categories or amounts." testId="share-summary" />
              </div>
            </Card>
          </Section>

          <Section title="Appearance" id="appearance">
            <Card>
              <ThemePicker initial={prefs.theme} />
              <p className="mt-2.5 text-[12.5px] text-ink-3">Saved per person. &ldquo;Match system&rdquo; follows your device setting.</p>
            </Card>
          </Section>
        </div>
      ),
    },
    {
      id: "assistant",
      label: "Assistant",
      summary: "Where answers come from, and whether they are spoken aloud.",
      content: (
        <Section title="Assistant & voice" id="assistant-voice">
          <Card>
            <p className="text-[14px]" data-testid="assistant-config">
              {config.anthropicApiKey ? (
                <><span className="chip chip-good mr-2">Connected</span>Claude via the server-side adapter ({config.model}). Streaming, cancellation and two retries are on. Money figures come from the finance engine, never from the model.</>
              ) : (
                <><span className="chip chip-warn mr-2">Preview mode</span>No model key on the server. Answers use the same tools with fixed wording and are labelled as previews.</>
              )}
            </p>
            {!config.anthropicApiKey && <pre className="mt-3 overflow-x-auto rounded-[var(--fd-radius-field)] bg-surface-3 p-3 text-[12.5px]">{`ANTHROPIC_API_KEY=sk-ant-...      # server environment only\nFINANCE_DESK_MODEL=claude-opus-5   # optional override`}</pre>}
            <div className="mt-4 border-t border-line pt-4">
              <Toggle field="spokenReplies" initial={prefs.spokenReplies} label="Speak replies aloud" description="Uses the browser's built-in speech synthesis. A Mute control appears while speaking. Push-to-talk uses the browser's speech recognition and only listens while you hold the button." testId="spoken-replies-setting" />
            </div>
          </Card>
        </Section>
      ),
    },
    {
      id: "payroll",
      label: "Payroll",
      summary: "Gross pay and withholding per person. Federal and state income tax withholding is never assumed.",
      content: (
        <Section title="Payroll" id="payroll-forms">
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
            {viewer.persons.filter((p) => p.userId === viewer.user.id).map((p) => (
              <Card key={p.id}>
                <PayrollForm personId={p.id} name={p.name} o={viewer.assumptions.owners[p.id]} editable={p.userId === viewer.user.id} rules={viewer.assumptions.payrollRules} isOwner={isOwner} />
              </Card>
            ))}
            {viewer.persons.filter((p) => p.userId !== viewer.user.id).map((p) => (
              <Notice key={p.id}>{p.name}&apos;s payroll details are private to them. Company payroll cost uses their gross salary only.</Notice>
            ))}
          </div>
        </Section>
      ),
    },
    ...(viewer.spaces.some((sp) => sp.kind === "company")
      ? [{
          id: "company",
          label: "Company",
          summary: "Every company figure derives from these. Blank means unknown and is never treated as zero.",
          content: (
            <Section title="Company, tax & budget" id="company-assumptions">
              <Card>
                {isOwner && <div className="mb-5 border-b border-line pb-5"><RenameWorkspaceForm name={viewer.workspace.name} /></div>}
                {canEditAssumptions(viewer) ? <CompanyForm a={viewer.assumptions} /> : <Notice>You need edit access to the company space to change these.</Notice>}
              </Card>
            </Section>
          ),
        } satisfies SettingsGroup]
      : []),
    {
      id: "people",
      label: "People",
      summary: "Roles apply per space. Personal spaces are private and cannot be shared.",
      content: (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
          <Section title="Members & permissions" id="members">
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
            <Section title="Invite links" id="invites" description="Finance Desk sends nothing. Create a link and share it yourself; it expires in seven days.">
              <Card>
                <InviteForm spaces={sharedSpaces.map((sp) => ({ id: sp.id, name: sp.name }))} />
                {invites.length > 0 && (
                  <ul className="mt-4 divide-y divide-line text-sm">
                    {invites.map((inv) => (
                      <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                        <span>{inv.personName}<span className="block text-xs text-ink-3">expires {inv.expiresAt.slice(0, 10)}</span></span>
                        <code className="max-w-full truncate rounded-[var(--fd-radius-field)] bg-surface-3 px-2 py-1 text-xs">/sign-in?invite={inv.code}</code>
                        <RevokeInviteButton id={inv.id} />
                      </li>
                    ))}
                  </ul>
                )}
                {config.mode === "demo" && <p className="mt-3 text-xs text-ink-3">In demo mode invite links can be created but registration is disabled; they become usable in live mode.</p>}
              </Card>
            </Section>
          )}
        </div>
      ),
    },
    {
      id: "data",
      label: "Data & export",
      summary: "How data gets in, and how to get it out again.",
      content: (
        <Section title="Integrations" id="integrations">
          <Card>
            <p className="text-[14px]">No bank, payroll, card or accounting connections. Data arrives by manual entry, receipts and CSV import.</p>
            <ul className="mt-2.5 list-disc space-y-1 pl-5 text-[13px] text-ink-2">
              <li>Bank / cards: export a CSV from the bank and import it under Activity.</li>
              <li>Payroll: copy the withholding lines from a pay stub into Payroll to make take-home verified.</li>
              <li>Accounting: use &ldquo;Export my visible data&rdquo; and share the JSON with your CPA.</li>
            </ul>
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
              <ModeBadge isDemo={viewer.isDemo} />
              <a className="btn btn-secondary btn-sm" href="/api/export">Export my visible data (JSON)</a>
              {viewer.isDemo && <ResetDemoButton />}
            </div>
          </Card>
        </Section>
      ),
    },
    {
      id: "plan-review",
      label: "Plan review",
      advanced: true,
      summary: "What is still unknown, what was superseded, and template records you can archive. You do not need this to use the app day to day.",
      content: (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
          <Card testId="review-queue">
            <p className="label">Open review items</p>
            {items.length === 0 ? <p className="mt-1 text-[13.5px] text-ink-3">Nothing outstanding.</p> : (
              <ul className="mt-2 divide-y divide-line">
                {items.map((i) => (
                  <li key={i.key} className="py-2.5 text-[14px]">
                    <span className={`chip mr-2 ${i.severity === "attention" ? "chip-warn" : "chip-neutral"}`}>{i.severity}</span>{i.label}
                    <span className="block text-[12.5px] text-ink-3">{i.blocks} · {i.where}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card testId="superseded">
            <p className="label">Superseded assumptions</p>
            {viewer.assumptions.superseded.length === 0 ? <p className="mt-1 text-[13.5px] text-ink-3">None.</p> : (
              <ul className="mt-2 divide-y divide-line">
                {viewer.assumptions.superseded.map((x, idx) => (
                  <li key={`${x.key}-${idx}`} className="py-2.5 text-[14px]">
                    <span className="line-through">{x.label}: {x.previousValue}</span>
                    <span className="block text-[12.5px] text-ink-3">Archived {x.supersededAt.slice(0, 10)} · {x.reason}</span>
                  </li>
                ))}
              </ul>
            )}
            {history.length > 0 && <p className="mt-2.5 text-[12.5px] text-ink-3">{history.length} earlier assumption version{history.length === 1 ? "" : "s"} kept with provenance ({Array.from(new Set(history.map((h) => h.provenance))).join(", ")}).</p>}
          </Card>
          <Card testId="plan-records">
            <p className="label">Goals and budgets on record</p>
            {planRecords.length === 0 ? <p className="mt-1 text-[13.5px] text-ink-3">None. Targets and allocations live in Money &rarr; My money and are set by you, not imposed.</p> : (
              <ul className="mt-2 divide-y divide-line">
                {planRecords.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-[14px]">
                    <span>{r.label}<span className="ml-2 text-[12.5px] text-ink-3">{r.space.name} · {r.entity} · source {r.source}{r.amount === null ? "" : ` · ${formatCents(r.amount)}/mo`}</span></span>
                    {canEdit(viewer, r.space.id) && <ArchiveRecordButton entity={r.entity} id={r.id} label={r.entity} />}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="Settings" description={viewer.workspace.name} actions={<SignOutButton />} />
      <SettingsTabs groups={groups} />
    </>
  );
}
