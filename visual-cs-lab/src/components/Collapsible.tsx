import { useState, type ReactNode } from 'react';

/**
 * A section header that folds its content away. Collapsed by default so long
 * detail lists stay out of the way until they are asked for.
 */
export default function Collapsible({
  title,
  summary,
  defaultOpen = false,
  children
}: {
  title: string;
  summary?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="collapsible">
      <button
        type="button"
        className="collapsible-head"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className="caret">{open ? '▾' : '▸'}</span>
        <strong>{title}</strong>
        {summary && <span className="summary">{summary}</span>}
      </button>
      {open && <div className="collapsible-body">{children}</div>}
    </section>
  );
}
