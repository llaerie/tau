/**
 * Split one economic expense between people. Shares always sum to the exact
 * amount in cents; any remainder goes to the first share so no cent is lost.
 */
export interface Share {
  personId: string;
  cents: number;
}

export function splitEqual(amountCents: number, personIds: string[]): Share[] {
  if (!Number.isInteger(amountCents) || amountCents < 0) throw new Error("amount must be a non-negative integer number of cents");
  if (personIds.length === 0) throw new Error("at least one person is required");
  const base = Math.floor(amountCents / personIds.length);
  let remainder = amountCents - base * personIds.length;
  return personIds.map((personId) => {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    return { personId, cents: base + extra };
  });
}

export function splitByCents(amountCents: number, shares: Share[]): Share[] {
  const sum = shares.reduce((a, s) => a + s.cents, 0);
  if (sum !== amountCents) throw new Error(`shares (${sum}) do not sum to the amount (${amountCents})`);
  if (shares.some((s) => s.cents < 0 || !Number.isInteger(s.cents))) throw new Error("share amounts must be non-negative integers");
  return shares;
}

/** What each non-payer owes the payer after a split. */
export function settlements(payerPersonId: string, shares: Share[]): { fromPersonId: string; toPersonId: string; cents: number }[] {
  return shares.filter((s) => s.personId !== payerPersonId && s.cents > 0).map((s) => ({ fromPersonId: s.personId, toPersonId: payerPersonId, cents: s.cents }));
}
