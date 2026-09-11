import type { Metadata } from "next";
import { pageCtx, type SearchParams } from "@/lib/ui/page";
import { PROVIDER_OPTIONS, PROVIDER_CONFIG_KEYS, phaseOneProviders } from "@/lib/integrations/providers";
import { MATERIALITY_CONFIG_KEYS } from "@/lib/risk/materiality";
import { getFallbackEvents, type ModelRegistryDescription } from "@/lib/models/registry";
import { isLabMode } from "@/lib/security/session";
import { permissionsFor } from "@/lib/security/rbac";
import { LAB_ROLES } from "@/lib/ui/session";
import { listUsers, MIN_PASSWORD_LENGTH } from "@/lib/security/users";
import { LogoutButton, ChangePasswordForm } from "@/components/auth/AccountForms";
import { workspaceSnapshotInfo } from "@/lib/ui/data";
import { currentWorkspace, hasBookData } from "@/lib/db/workspace";
import { PageHeader, Tabs, pickTab, Card, CardHeader, TableWrap, StatusPill, Badge, Notice, KeyValue } from "@/components/ui";
import { RoleSwitcher, ProviderWizard, MaterialityForm, ResetLab } from "@/components/settings/SettingsForms";
import { fmtDate, fmtDateTime, fmtMoney, titleCase } from "@/lib/ui/format";
import { can } from "@/lib/security/rbac";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

const TABS = ["providers", "models", "materiality", "session", "data"];

export default async function SettingsPage({ searchParams }: { searchParams: SearchParams }) {
  const q = await searchParams;
  const tab = pickTab(q.tab, TABS);
  const { rt, actor } = await pageCtx();
  const canEdit = can(actor.role, "EDIT_CONFIG");
  const current = (key: string) => rt.dataset.configFields.find((f) => f.key === key && f.status !== "SUPERSEDED");
  const choices: Record<string, string | null> = {
    ACCOUNTING: (current(PROVIDER_CONFIG_KEYS.ACCOUNTING)?.value as string | undefined) ?? null,
    PAYROLL: (current(PROVIDER_CONFIG_KEYS.PAYROLL)?.value as string | undefined) ?? null,
    BANK_DATA: (current(PROVIDER_CONFIG_KEYS.BANK_DATA)?.value as string | undefined) ?? null,
    DOCUMENT: (current(PROVIDER_CONFIG_KEYS.DOCUMENT)?.value as string | undefined) ?? null,
    INTERNATIONAL_WORKFORCE: (current(PROVIDER_CONFIG_KEYS.INTERNATIONAL)?.value as string | undefined) ?? null,
  };
  const providers = phaseOneProviders();
  const providerInfos = [providers.accounting.info(), providers.payroll.info(), providers.bank.info(), providers.documents.info()];
  const base = rt.models.describe() as Partial<ModelRegistryDescription> & ReturnType<typeof rt.models.describe>;
  const models: ModelRegistryDescription = { ...base, promptVersion: base.promptVersion ?? "unknown", fallbackTimeoutMs: base.fallbackTimeoutMs ?? 0, chains: base.chains ?? { reasoning: [base.reasoning], fast: [base.fast], verification: [base.verification], embedding: [base.embedding] }, fallbackEvents: base.fallbackEvents ?? [] };
  const fallbackEvents = [...getFallbackEvents()].reverse().slice(0, 25);
  const thr = rt.thresholds;
  const materialityFields = Object.entries(MATERIALITY_CONFIG_KEYS).map(([k, key]) => ({ k, key, field: current(key) }));
  const snapshot = workspaceSnapshotInfo();
  const workspace = currentWorkspace();
  const labMode = isLabMode();
  const users = !labMode && can(actor.role, "MANAGE_USERS") ? listUsers() : null;

  return (
    <>
      <PageHeader title="Settings" description="Provider setup (choices only), model provider status, materiality thresholds, lab session role, and lab data controls." />
      <Tabs basePath="/settings" active={tab} tabs={[{ key: "providers", label: "Providers" }, { key: "models", label: "Model providers" }, { key: "materiality", label: "Materiality" }, { key: "session", label: "Session & roles" }, { key: "data", label: workspace === "company" ? "Workspace & data" : "Lab data" }]} />

      {tab === "providers" ? (
        <div className="space-y-4">
          <Notice tone="warn" title="No live account is ever created here">The wizard records which vendors the company intends to use as UNCONFIRMED config choices. Adapters stay NOT_CONNECTED in Phase One; read-only pulls arrive in Phase Two and whitelisted writes no earlier than Phase Four.</Notice>
          <Card padded={false}>
            <CardHeader title="Adapter status" className="px-4 pt-3" />
            <TableWrap className="border-0">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Adapter</th>
                    <th>Kind</th>
                    <th>Status</th>
                    <th>Earliest write phase</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {providerInfos.map((p) => (
                    <tr key={p.key}>
                      <td className="font-medium">{p.vendor}</td>
                      <td className="text-muted">{titleCase(p.kind)}</td>
                      <td>
                        <StatusPill status={p.status} />
                      </td>
                      <td>Phase {p.earliestWritePhase}</td>
                      <td className="text-[11px] text-muted">{p.notes.join(" ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Card>
          <Card>
            <CardHeader title="Setup wizard" subtitle="Pick the intended vendor per category. Each choice is written to the finance bible with status UNCONFIRMED." />
            <ProviderWizard options={PROVIDER_OPTIONS} choices={choices} canEdit={canEdit} />
          </Card>
        </div>
      ) : null}

      {tab === "models" ? (
        <div className="space-y-4">
          <Card>
            <CardHeader title="Model registry" subtitle={`Provider ${models.provider} · prompt version ${models.promptVersion} · fallback timeout ${models.fallbackTimeoutMs} ms`} actions={<Badge tone={models.provider === "local" ? "info" : "ok"}>{models.provider}</Badge>} />
            <TableWrap className="border-0">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Role</th>
                    <th>Active model</th>
                    <th>Deterministic</th>
                    <th>Fallback chain</th>
                  </tr>
                </thead>
                <tbody>
                  {(["reasoning", "fast", "verification", "embedding"] as const).map((role) => (
                    <tr key={role}>
                      <td className="font-medium">{titleCase(role)}</td>
                      <td className="mono">
                        {models[role].provider}/{models[role].model}
                        {models[role].version ? ` @${models[role].version}` : ""}
                      </td>
                      <td>{models[role].deterministic ? <Badge tone="info">deterministic</Badge> : <Badge tone="ok">remote</Badge>}</td>
                      <td className="mono text-[11px] text-muted">{models.chains[role].map((m) => `${m.provider}/${m.model}`).join(" → ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
            <p className="mt-2 text-[12px] text-muted">The local deterministic provider is always the last link in every chain, so the lab works without any API key. Keys are read from the environment only and never appear in prompts or logs.</p>
          </Card>
          <Card padded={false}>
            <CardHeader title={`Fallback events (${fallbackEvents.length})`} className="px-4 pt-3" subtitle="Recorded whenever a call failed over to the next provider. Sanitised: no prompt or response text." />
            <TableWrap className="border-0">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>At</th>
                    <th>Role</th>
                    <th>Operation</th>
                    <th>From → to</th>
                    <th>Reason</th>
                    <th className="r">ms</th>
                  </tr>
                </thead>
                <tbody>
                  {fallbackEvents.map((e, i) => (
                    <tr key={i}>
                      <td className="whitespace-nowrap text-muted">{fmtDateTime(e.at)}</td>
                      <td>{e.role}</td>
                      <td className="mono">{e.operation}</td>
                      <td className="mono text-[11px]">
                        {e.from.provider}/{e.from.model} → {e.to ? `${e.to.provider}/${e.to.model}` : "none"}
                      </td>
                      <td>
                        <Badge tone="warn">{e.reason}</Badge> <span className="text-[11px] text-muted">{e.detail}</span>
                      </td>
                      <td className="r">{e.elapsedMs}</td>
                    </tr>
                  ))}
                  {fallbackEvents.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-muted">
                        No fallback events in this process.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </TableWrap>
          </Card>
        </div>
      ) : null}

      {tab === "materiality" ? (
        <div className="space-y-4">
          <Card>
            <CardHeader title="Materiality thresholds" subtitle="Drive the risk engine. Lab defaults are UNCONFIRMED until the owner confirms them here (or in Company setup)." actions={<StatusPill status={thr.status} />} />
            <TableWrap className="mb-4 border-0">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Threshold</th>
                    <th className="r">Live value</th>
                    <th>Config status</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {materialityFields.map(({ k, key, field }) => {
                    const v = thr[k as keyof typeof thr];
                    const isRatio = k === "forecastChangeRatio" || k === "varianceRatio";
                    return (
                      <tr key={key}>
                        <td>
                          {titleCase(k)} <span className="mono text-faint">{key}</span>
                        </td>
                        <td className="r">{v === null ? <span className="text-warn">policy not set</span> : isRatio ? `${(Number(v) * 100).toFixed(1)}%` : typeof v === "string" ? fmtMoney(v) : String(v)}</td>
                        <td>
                          <StatusPill status={field?.status ?? "UNCONFIRMED"} />
                        </td>
                        <td className="text-[11px] text-muted">{field?.updatedAt ? `${fmtDateTime(field.updatedAt)} · ${field.updatedBy}` : "lab default"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
            <MaterialityForm current={{ transactionReviewAmount: thr.transactionReviewAmount, redAmount: thr.redAmount, forecastChangeAmount: thr.forecastChangeAmount, forecastChangeRatio: thr.forecastChangeRatio, varianceRatio: thr.varianceRatio, minimumCashReserve: thr.minimumCashReserve }} canEdit={canEdit} />
          </Card>
        </div>
      ) : null}

      {tab === "session" ? (
        <div className="space-y-4">
          {labMode ? (
            <Card>
              <CardHeader title="Lab session role" subtitle="Switches the signed session cookie. RBAC is enforced server-side on every page and API call. Lab mode only." actions={<Badge tone="warn">TAU_AUTH_MODE=lab</Badge>} />
              <KeyValue dense className="mb-3" items={[{ k: "Actor", v: `${actor.displayName ?? actor.id} (${actor.id})` }, { k: "Role", v: actor.role, mono: true }, { k: "Permissions", v: <span className="flex flex-wrap gap-1">{permissionsFor(actor.role).map((p) => <Badge key={p}>{p}</Badge>)}</span> }]} />
              <RoleSwitcher current={actor.role} roles={[...LAB_ROLES]} labMode />
              <p className="mt-3 text-[11px] text-faint">Password-based sign-in switches on automatically once a user exists: <span className="mono">npm run users:add -- --email you@example.com --name &quot;Name&quot; --role OWNER</span></p>
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader title="Signed in as" subtitle="Roles are assigned by an owner from the command line (npm run users:add). RBAC is enforced server-side on every page and API call." actions={<Badge tone="ok">full auth</Badge>} />
                <KeyValue dense className="mb-3" items={[{ k: "User", v: `${actor.displayName ?? actor.id} (${actor.id})` }, { k: "Role", v: actor.role, mono: true }, { k: "Permissions", v: <span className="flex flex-wrap gap-1">{permissionsFor(actor.role).map((p) => <Badge key={p}>{p}</Badge>)}</span> }]} />
                <LogoutButton />
              </Card>
              <Card>
                <CardHeader title="Change password" subtitle="Requires your current password. Five failed attempts lock sign-in for 15 minutes." />
                <ChangePasswordForm minLength={MIN_PASSWORD_LENGTH} />
              </Card>
              {users ? (
                <Card padded={false}>
                  <CardHeader title={`Users (${users.length})`} className="px-4 pt-3" subtitle="Add or remove users with npm run users:add / users:list. Password hashes never leave the server." />
                  <TableWrap className="border-0">
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Email</th>
                          <th>Role</th>
                          <th>Created</th>
                        </tr>
                      </thead>
                      <tbody>
                        {users.map((u) => (
                          <tr key={u.id}>
                            <td className="font-medium">{u.displayName}</td>
                            <td className="mono">{u.email}</td>
                            <td className="mono">{u.role}</td>
                            <td className="text-muted">{fmtDate(u.createdAt.slice(0, 10))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TableWrap>
                </Card>
              ) : null}
            </>
          )}
          <Card padded={false}>
            <CardHeader title="Role matrix" className="px-4 pt-3" />
            <TableWrap className="border-0">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Role</th>
                    <th>Permissions</th>
                  </tr>
                </thead>
                <tbody>
                  {LAB_ROLES.map((r) => (
                    <tr key={r}>
                      <td className="mono">{r}</td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {permissionsFor(r).map((p) => (
                            <Badge key={p}>{p}</Badge>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Card>
        </div>
      ) : null}

      {tab === "data" ? (
        <div className="space-y-4">
          <Notice tone="info" title="Data separation">
            Household and personal finances are a separate system by design. No business role — including OWNER — is granted VIEW_HOUSEHOLD, and personal items found in business accounts are flagged, never categorized as business.
          </Notice>
          <Card>
            <CardHeader title="Workspace" subtitle="Which dataset this console serves. The lab and company snapshots are separate files and never mix." actions={<Badge tone={workspace === "company" ? "accent" : "warn"}>{workspace === "company" ? "TAU_WORKSPACE=company" : "TAU_WORKSPACE=lab (default)"}</Badge>} />
            <KeyValue
              dense
              items={[
                { k: "Active workspace", v: workspace === "company" ? "Your company — real books (Phase Two read-only; no bank, card, payroll or accounting connection)" : "Synthetic training lab — Northlight AI Services LLC (fictional)" },
                { k: "Switch", v: <span>Set the <span className="mono">TAU_WORKSPACE</span> environment variable to <span className="mono">company</span> or <span className="mono">lab</span> and restart the server (e.g. <span className="mono">TAU_WORKSPACE=company npm run dev</span>). Create the company snapshot first with <span className="mono">npm run company:init</span>; the lab is seeded with <span className="mono">npm run lab:seed</span>.</span> },
                { k: "Snapshot", v: `${snapshot.path}${snapshot.exists ? "" : " (not created yet)"}`, mono: true },
              ]}
            />
          </Card>
          <Card>
            <CardHeader title={workspace === "company" ? "Company dataset" : "Lab dataset"} />
            <KeyValue
              dense
              items={[
                { k: "Company", v: `${rt.dataset.profile.displayName}${rt.dataset.profile.isSynthetic ? " (synthetic)" : ""}` },
                { k: "As of", v: rt.asOfDate },
                { k: "Store", v: `${rt.store.kind}${snapshot.exists ? ` · snapshot at ${snapshot.path}` : " · no snapshot yet"}` },
                { k: "Books", v: hasBookData(rt.dataset) ? "posted entries present" : "EMPTY — no posted entries; cash and balances are UNKNOWN (not zero)" },
                { k: "Records", v: `${rt.dataset.transactions.length} transactions · ${rt.dataset.journalEntries.length} entries · ${rt.dataset.bankAccounts.length} bank accounts · ${rt.dataset.cards.length} cards · ${rt.dataset.documents.length} documents · ${rt.dataset.auditEvents.length} audit events` },
                { k: "Simulation only", v: rt.simulationOnly ? "yes — nothing leaves the system" : "no" },
              ]}
            />
          </Card>
          {workspace === "company" ? (
            <Card>
              <CardHeader title="Reset" />
              <Notice tone="bad" title="Reset is disabled in the company workspace">
                Resetting would delete the owners&apos; real entries, so the console does not offer it. To start over deliberately, stop the server and run <span className="mono">npm run company:init -- --force</span> (the previous snapshot is kept as a .bak file). Lab data is never loaded into this workspace.
              </Notice>
            </Card>
          ) : (
            <Card>
              <CardHeader title="Reset lab data" />
              <ResetLab canReset={can(actor.role, "MANAGE_USERS")} />
            </Card>
          )}
        </div>
      ) : null}
    </>
  );
}
