/** Small deterministic PRNG (mulberry32). Integer ops only: identical on every JS engine. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Combine integers into one 32-bit seed (FNV-style). */
export function mix(...values: number[]): number {
  let h = 0x811c9dc5;
  for (const v of values) {
    h = Math.imul(h ^ (v >>> 0), 16777619);
    h ^= h >>> 13;
  }
  return h >>> 0;
}

export function randomSeed(): number {
  return (Math.random() * 4294967296) >>> 0;
}
