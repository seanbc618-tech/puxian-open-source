export type PrintStatus = "pending" | "ready" | "error";

/** One ready sheet per input identity; stale work can neither draw nor print. */
export function createPrintReadiness() {
  let generation = 0;
  let key: unknown;
  let task: Promise<boolean> | undefined;
  let status: PrintStatus = "pending";
  let printing = false;

  function select(next: unknown) {
    if (key === next) return;
    key = next;
    generation++;
    task = undefined;
    status = "pending";
  }

  function prepare(
    next: unknown,
    build: (current: () => boolean) => Promise<void>,
    report: (status: PrintStatus) => void,
  ) {
    select(next);
    if (task && status !== "error") return task;
    const requested = ++generation;
    const current = () => requested === generation && key === next;
    status = "pending";
    report(status);
    task = (async () => {
      try {
        await build(current);
        if (!current()) return false;
        status = "ready";
        report(status);
        return true;
      } catch {
        if (current()) {
          status = "error";
          report(status);
        }
        return false;
      }
    })();
    return task;
  }

  return {
    select,
    prepare,
    async print(
      next: unknown,
      build: (current: () => boolean) => Promise<void>,
      report: (status: PrintStatus) => void,
      print: () => void,
    ) {
      if (printing) return;
      printing = true;
      try {
        if ((await prepare(next, build, report)) && key === next && status === "ready") print();
      } finally {
        printing = false;
      }
    },
  };
}
