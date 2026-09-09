/** Deterministic seeded PRNG (mulberry32) so synthetic data and evals are reproducible. */
export class SeededRandom {
  private state: number;
  constructor(seed: number | string) {
    this.state = typeof seed === "number" ? seed >>> 0 : hashString(seed);
  }
  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
  float(min: number, max: number): number {
    return this.next() * (max - min) + min;
  }
  /** Money-ish amount rounded to cents, as a decimal string */
  amount(min: number, max: number): string {
    return (Math.round(this.float(min, max) * 100) / 100).toFixed(2);
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  fork(label: string): SeededRandom {
    return new SeededRandom(hashString(`${this.state}:${label}`));
  }
}

export function hashString(s: string): number {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}
