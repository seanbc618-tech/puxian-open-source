import assert from "node:assert/strict";
import { test } from "node:test";
import { createPrintReadiness, type PrintStatus } from "./print-readiness.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("print click waits for delayed abcjs load and shares the effect's generation", async () => {
  const gate = createPrintReadiness();
  const load = deferred();
  const key = {};
  let builds = 0;
  let draws = 0;
  let prints = 0;
  const statuses: PrintStatus[] = [];
  const build = async (current: () => boolean) => {
    builds++;
    await load.promise;
    if (current()) draws++;
  };
  const prepared = gate.prepare(key, build, (status) => statuses.push(status));
  const clicked = gate.print(
    key,
    build,
    (status) => statuses.push(status),
    () => {
      prints++;
    },
  );
  assert.equal(prints, 0);
  assert.equal(draws, 0);
  load.resolve();
  await Promise.all([prepared, clicked]);
  assert.equal(builds, 1);
  assert.equal(draws, 1);
  assert.equal(prints, 1);
  assert.deepEqual(statuses, ["pending", "ready"]);
});

test("generation failure reports an error without printing and the next click retries", async () => {
  for (const failure of ["load", "draw"]) {
    const gate = createPrintReadiness();
    const statuses: PrintStatus[] = [];
    const key = {};
    let attempts = 0;
    let prints = 0;
    const build = async () => {
      attempts++;
      if (failure === "draw") await Promise.resolve();
      if (attempts === 1) throw new Error(failure);
    };
    const report = (status: PrintStatus) => statuses.push(status);
    const print = () => {
      prints++;
    };
    await gate.print(key, build, report, print);
    assert.equal(prints, 0);
    assert.deepEqual(statuses, ["pending", "error"]);
    await gate.print(key, build, report, print);
    assert.equal(attempts, 2);
    assert.equal(prints, 1);
    assert.deepEqual(statuses, ["pending", "error", "pending", "ready"]);
  }
});

test("changed inputs invalidate a pending print and stale work cannot draw or report ready", async () => {
  const gate = createPrintReadiness();
  const load = deferred();
  const statuses: PrintStatus[] = [];
  let draws = 0;
  let prints = 0;
  const clicked = gate.print(
    {},
    async (current) => {
      await load.promise;
      if (current()) draws++;
    },
    (status) => statuses.push(status),
    () => {
      prints++;
    },
  );
  gate.select({});
  load.resolve();
  await clicked;
  assert.equal(draws, 0);
  assert.equal(prints, 0);
  assert.deepEqual(statuses, ["pending"]);
});

test("a ready sheet is reused only for matching inputs", async () => {
  const gate = createPrintReadiness();
  const key = {};
  let draws = 0;
  let prints = 0;
  const build = async () => {
    draws++;
  };
  const print = () => {
    prints++;
  };
  await gate.prepare(key, build, () => {});
  await gate.print(key, build, () => {}, print);
  await gate.print({}, build, () => {}, print);
  assert.equal(draws, 2);
  assert.equal(prints, 2);
});
