"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Header links; the current page glows. */
export function NavLinks({ links }: { links: { href: string; label: string; count?: number }[] }) {
  const path = usePathname() ?? "";
  return (
    <nav className="flex flex-wrap gap-1 whitespace-nowrap">
      {links.map((l) => {
        const active = path === l.href || (l.href !== "/dashboard" && path.startsWith(l.href));
        return (
          <Link key={l.href} href={l.href} className={`nav-link ${active ? "active" : ""}`}>
            {l.label}
            {l.count ? (
              <span className="ml-1.5 rounded-full bg-fuchsia-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white" data-testid="nav-count">
                {l.count > 99 ? "99+" : l.count}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
