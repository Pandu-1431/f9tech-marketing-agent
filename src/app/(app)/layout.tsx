import Link from "next/link";
import { logoutAction } from "@/app/actions/auth";
import { requireAuth } from "@/lib/auth";
import { trialInfo } from "@/lib/plan";
import { canEditContent, canManageTeam, listMyWorkspaces, ROLE_LABELS } from "@/lib/team";
import { switchWorkspaceAction } from "@/app/actions/team";
import { NavLinks } from "@/components/ui/nav-links";
import { Wordmark } from "@/components/ui/logo";
import { reviewCount } from "@/lib/review";
import { newLeadCount } from "@/lib/leads";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, workspace, role } = await requireAuth();
  const [trial, myWorkspaces, waiting, newLeads] = await Promise.all([trialInfo(workspace.id), listMyWorkspaces(user.id), reviewCount(workspace.id), newLeadCount(workspace.id)]);

  const review = { href: "/review", label: "Review", count: waiting };
  const links = [
    // Client reviewers come to approve: put Review first for them.
    ...(role === "client" ? [review] : []),
    { href: "/dashboard", label: "Dashboard" },
    { href: "/brands", label: "Business accounts" },
    { href: "/campaigns", label: "Campaigns" },
    ...(role === "client" ? [] : [review]),
    { href: "/calendar", label: "Calendar" },
    { href: "/library", label: "Library" },
    { href: "/leads", label: "Leads", count: newLeads },
    { href: "/tracker", label: "Tracker" },
    ...(canEditContent(role) ? [{ href: "/settings/ai", label: "AI connections" }] : []),
    ...(canManageTeam(role) ? [{ href: "/settings/team", label: "Team" }] : []),
  ];

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="sticky top-0 z-30 print:hidden border-b border-white/10 bg-[#120f2e]/85 backdrop-blur-xl">
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-fuchsia-400/70 to-transparent" />
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-5 gap-y-2 px-6 py-2.5">
          <Link href="/dashboard" aria-label="MarketingAgent home"><Wordmark /></Link>
          <NavLinks links={links} />
          <div className="ml-auto flex items-center gap-3 whitespace-nowrap text-sm text-white/70">
            {myWorkspaces.length > 1 && (
              <form action={switchWorkspaceAction} className="flex items-center gap-1">
                <select name="workspaceId" defaultValue={workspace.id} className="rounded-md border border-white/20 bg-white/10 px-1.5 py-1 text-xs text-white" aria-label="Workspace">
                  {myWorkspaces.map((w) => (
                    <option key={w.id} value={w.id} className="text-zinc-900">{w.name} ({ROLE_LABELS[w.role] ?? w.role})</option>
                  ))}
                </select>
                <button className="text-xs text-fuchsia-300">Switch</button>
              </form>
            )}
            {role === "client" && <span className="badge bg-sky-400/15 text-sky-200" data-testid="client-badge">Client reviewer</span>}
            <span className="hidden items-center gap-2 xl:flex">
              <span className="live-dot" />
              {workspace.name}
              {!trial.enabled ? (
                <span className="badge bg-emerald-400/15 text-emerald-200">Free plan</span>
              ) : trial.active ? (
                <span className="badge bg-emerald-400/15 text-emerald-200">Free trial · {trial.daysLeft} days left</span>
              ) : (
                <span className="badge bg-red-400/20 text-red-200">Trial ended</span>
              )}
            </span>
            <span className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-indigo-400 to-fuchsia-500 text-xs font-bold text-white" title={user.name}>
              {user.name.trim().slice(0, 1).toUpperCase()}
            </span>
            <span className="hidden text-white/85 lg:inline">{user.name}</span>
            <form action={logoutAction}>
              <button className="text-white/60 hover:text-white">Log out</button>
            </form>
          </div>
        </div>
      </header>
      {!trial.active && (
        <div className="bg-red-50 px-6 py-2 text-center text-sm text-red-800 print:hidden">
          Your free trial has ended. Your content is safe, but new AI generation is paused.
        </div>
      )}
      <main className="reveal mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
