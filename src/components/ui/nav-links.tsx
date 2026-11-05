"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Header links; the current page glows. */
export function NavLinks({ links }: { links: { href: string; label: string }[] }) {
  const path = usePathname() ?? "";
  return (
    <nav className="flex flex-wrap gap-1 whitespace-nowrap">
      {links.map((l) => {
        const active = path === l.href || (l.href !== "/dashboard" && path.startsWith(l.href));
        return (
          <Link key={l.href} href={l.href} className={`nav-link ${active ? "active" : ""}`}>
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
