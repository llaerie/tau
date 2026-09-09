import { redirect } from "next/navigation";
import { CompanyAssumptionsForm, OwnerAssumptionsForm } from "@/components/forms/AssumptionsForms";
import { Card, Notice, PageHeader, Section } from "@/components/ui";
import { requireViewer } from "@/lib/actions/helpers";
import { canEditAssumptions } from "@/lib/auth/authorize";

export const metadata = { title: "Set up" };

export default async function OnboardingPage() {
  const viewer = await requireViewer();
  if (!canEditAssumptions(viewer)) redirect("/");
  return (
    <>
      <PageHeader eyebrow="Set up" title="Start with what you know" description="Everything here can be changed later in Settings. Leave a field blank when you do not know it; Finance Desk will show it as unknown and never quietly use zero." />
      <div className="mb-6">
        <Notice tone="neutral">Three rules are baked in: revenue is company money, owner salaries are gross, and goals marked priority 1 are funded before discretionary spending.</Notice>
      </div>
      <Section title="1 · Each owner" description="Gross salary from the company and what each person sends to the household.">
        <div className="grid gap-3 lg:grid-cols-2">
          {viewer.persons.map((p) => (
            <Card key={p.id}>
              <OwnerAssumptionsForm personId={p.id} name={p.name} o={viewer.assumptions.owners[p.id]} editable={p.userId === viewer.user.id || viewer.workspaceRole === "owner"} />
            </Card>
          ))}
        </div>
      </Section>
      <Section title="2 · The company" description="Saving this also marks set-up as complete and opens the overview.">
        <Card>
          <CompanyAssumptionsForm a={viewer.assumptions} completeOnboarding submitLabel="Save and open the overview" />
        </Card>
      </Section>
      <p className="text-sm text-ink-3">Next: add accounts with balances, bills and goals from the Accounts page, then record transactions or import a CSV.</p>
    </>
  );
}
