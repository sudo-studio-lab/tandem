import type { ReactNode } from "react";

export function Ext({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={className}>
      {children}
    </a>
  );
}

export function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  const id = `sec-${title}`;
  return (
    <section className="section" aria-labelledby={id}>
      <h2 id={id}>
        {title}
        {count !== undefined && <span className="count">{count}</span>}
      </h2>
      {children}
    </section>
  );
}
