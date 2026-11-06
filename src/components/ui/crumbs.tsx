import Link from "next/link";

/** "Business accounts › Sweet Shop › Blog": where you are and the way back. */
export function Crumbs({ items }: { items: { href?: string; label: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-sm text-zinc-500 print:hidden" data-testid="crumbs">
      {items.map((it, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-zinc-300">›</span>}
          {it.href ? <Link href={it.href} className="hover:text-indigo-700 hover:underline">{it.label}</Link> : <span className="font-medium text-zinc-800">{it.label}</span>}
        </span>
      ))}
    </nav>
  );
}
