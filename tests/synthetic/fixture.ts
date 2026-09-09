import { generateSyntheticCompany, type SyntheticCompanyDataset } from "@/lib/synthetic";

let cached: SyntheticCompanyDataset | undefined;
/** One shared default dataset per test file (generation is deterministic, so sharing is safe as long as tests do not mutate it). */
export function defaultDataset(): SyntheticCompanyDataset {
  if (!cached) cached = generateSyntheticCompany();
  return cached;
}
