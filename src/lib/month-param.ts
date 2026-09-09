import { currentMonth } from "./ids";

export function monthFromParam(v: string | string[] | undefined): string {
  const s = Array.isArray(v) ? v[0] : v;
  return s && /^\d{4}-(0[1-9]|1[0-2])$/.test(s) ? s : currentMonth();
}
