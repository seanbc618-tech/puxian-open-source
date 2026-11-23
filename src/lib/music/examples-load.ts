import type { Score } from "./theory.ts";

/** Lazy loaders only. Do not import this module from the first-screen home bundle. */
const LOADERS: Record<string, () => Promise<{ score: Score }>> = {
  hr2: () => import("./examples-pd/hr2.ts"),
  elise: () => import("./examples-pd/elise.ts"),
  moonlight: () => import("./examples-pd/moonlight.ts"),
  "alla-turca": () => import("./examples-pd/alla-turca.ts"),
  nachtmusik: () => import("./examples-pd/nachtmusik.ts"),
  "wtc-prelude": () => import("./examples-pd/wtc-prelude.ts"),
  canon: () => import("./examples-pd/canon.ts"),
  nocturne: () => import("./examples-pd/nocturne.ts"),
  gymnopedie: () => import("./examples-pd/gymnopedie.ts"),
  "clair-de-lune": () => import("./examples-pd/clair-de-lune.ts"),
  lullaby: () => import("./examples-pd/lullaby.ts"),
  "blue-danube": () => import("./examples-pd/blue-danube.ts"),
  radetzky: () => import("./examples-pd/radetzky.ts"),
  arabesque: () => import("./examples-pd/arabesque.ts"),
  fille: () => import("./examples-pd/fille.ts"),
  barcarolle: () => import("./examples-pd/barcarolle.ts"),
  "minute-waltz": () => import("./examples-pd/minute-waltz.ts"),
};

export async function loadExampleScore(id: string): Promise<Score> {
  const load = LOADERS[id];
  if (!load) throw new Error(`没有这首示例曲：${id}`);
  return { ...(await load()).score, staffInstrument: "piano" };
}
