import type { ReactNode } from "react";
import { isPrimaryZone } from "./zone-layout";

/** Keep panel contents mounted: audio, export and input refs survive collapsing. */
export function Zone({ id, title, hint, children, className, active = false }: {
  id: string;
  title: string;
  hint: string;
  children: ReactNode;
  className?: string;
  active?: boolean;
}) {
  const heading = <span id={`${id}-heading`} className="zone-title">{title}</span>;
  const help = <details className="zone-help"><summary>了解更多</summary><p>{hint}</p></details>;
  if (isPrimaryZone(id)) {
    return <section id={id} className={`zone zone-primary ${className ?? ""}`} aria-labelledby={`${id}-heading`}>
      <h2>{heading}</h2>{help}<div className="zone-content">{children}</div>
    </section>;
  }
  return <section id={id} role="tabpanel" aria-labelledby={`tab-${id}`}
    tabIndex={0} hidden={!active} className={`zone zone-panel ${className ?? ""}`}>
    <h2>{heading}</h2>
    {help}<div className="zone-content">{children}</div>
  </section>;
}
