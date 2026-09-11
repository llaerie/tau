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
        <Notice tone="neutral">Three rules are baked in: revenue is company money, salaries are gross W-2 pay, and goals marked priority 1 are funded before discretionary spending. Rent, cars, groceries and dining together belong to the household, not to personal budgets.</Notice>
      </div>
      <Section title="1 · Each person" description="Role, gross salary from the company, withholding, and any contribution to the household.">
        <div className="grid gap-3 lg:grid-cols-2">
          {viewer.persons.map((p) => (
            <Card key={p.id}>
              <OwnerAssumptionsForm personId={p.id} name={p.name} title={p.title} o={viewer.assumptions.owners[p.id]} editable={p.userId === viewer.user.id || viewer.workspaceRole === "owner"} />
            </Card>
          ))}
        </div>
      </Section>
      <Section title="2 · The company" description="Revenue, monthly allocations, rates, and the planned distribution that funds the household. Saving this marks set-up as complete and opens the overview.">
        <Card>
          <CompanyAssumptionsForm a={viewer.assumptions} completeOnboarding submitLabel="Save and open the overview" />
        </Card>
      </Section>
      <p className="text-sm text-ink-3">Next: add accounts with balances, bills and goals from the Accounts page, then record transactions or import a CSV.</p>
    </>
  );
}
