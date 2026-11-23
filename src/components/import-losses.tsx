import { quiet } from "./ui/styles";

export type ImportReport = {
  /** e.g. "MusicXML"、"123 简谱". */
  source: string;
  losses: string[];
  notes: string[];
};

/** Persistent "本次导入丢失了什么" list. It never auto-fades, so nothing is flattened silently. */
export function ImportLosses({ report, onClose }: { report: ImportReport; onClose: () => void }) {
  const count = report.losses.length;
  return (
    <section className="import-losses mt-3 rounded-2xl border border-line bg-paper px-3 py-2 text-sm" aria-label="本次导入丢失了什么">
      <div className="flex items-start justify-between gap-2">
        <h3 className="py-2 font-medium text-ink">
          {count ? `本次导入丢失了什么（${report.source}，${count} 项）` : `本次导入没有发现丢失（${report.source}）`}
        </h3>
        <button type="button" className={quiet} onClick={onClose} aria-label="收起导入清单">收起</button>
      </div>
      {count ? (
        <ul className="list-disc pl-5 leading-6 text-ink">
          {report.losses.map((item) => <li key={item}>{item}</li>)}
        </ul>
      ) : null}
      {report.notes.length ? (
        <ul className="mt-1 pl-0 leading-6 text-muted">
          {report.notes.map((item) => <li key={item}>说明：{item}</li>)}
        </ul>
      ) : null}
      <p className="mt-1 text-muted">原文件没有被改动；这些内容需要的话请在原软件里保留。</p>
    </section>
  );
}
