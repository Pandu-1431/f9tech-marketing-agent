import Link from "next/link";
import { logoutAction } from "@/app/actions/auth";
import { requireAuth } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, workspace } = await requireAuth();

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3">
          <Link href="/dashboard" className="font-semibold">MarketingAgent</Link>
          <nav className="flex gap-4 text-sm text-zinc-600">
            <Link href="/dashboard" className="hover:text-zinc-900">Dashboard</Link>
            <Link href="/brands" className="hover:text-zinc-900">Business accounts</Link>
            <Link href="/campaigns" className="hover:text-zinc-900">Campaigns</Link>
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-zinc-500">
              {workspace.name} · <span className="badge bg-emerald-50 text-emerald-700">{workspace.plan} plan</span>
            </span>
            <span className="text-zinc-400">|</span>
            <span>{user.name}</span>
            <form action={logoutAction}>
              <button className="text-zinc-500 hover:text-zinc-900">Log out</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
