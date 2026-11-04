import Link from "next/link";
import { logoutAction } from "@/app/actions/auth";
import { requireAuth } from "@/lib/auth";
import { trialInfo } from "@/lib/plan";
import { canEditContent, canManageTeam, listMyWorkspaces, ROLE_LABELS } from "@/lib/team";
import { switchWorkspaceAction } from "@/app/actions/team";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, workspace, role } = await requireAuth();
  const [trial, myWorkspaces] = await Promise.all([trialInfo(workspace.id), listMyWorkspaces(user.id)]);

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3">
          <Link href="/dashboard" className="font-semibold">MarketingAgent</Link>
          <nav className="flex gap-4 text-sm text-zinc-600">
            <Link href="/dashboard" className="hover:text-zinc-900">Dashboard</Link>
            <Link href="/brands" className="hover:text-zinc-900">Business accounts</Link>
            <Link href="/campaigns" className="hover:text-zinc-900">Campaigns</Link>
            <Link href="/library" className="hover:text-zinc-900">Library</Link>
            {canEditContent(role) && <Link href="/settings/ai" className="hover:text-zinc-900">AI connections</Link>}
            {canManageTeam(role) && <Link href="/settings/team" className="hover:text-zinc-900">Team</Link>}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            {myWorkspaces.length > 1 && (
              <form action={switchWorkspaceAction} className="flex items-center gap-1">
                <select name="workspaceId" defaultValue={workspace.id} className="rounded-md border border-zinc-200 px-1.5 py-1 text-xs" aria-label="Workspace">
                  {myWorkspaces.map((w) => (
                    <option key={w.id} value={w.id}>{w.name} ({ROLE_LABELS[w.role] ?? w.role})</option>
                  ))}
                </select>
                <button className="text-xs text-indigo-600">Switch</button>
              </form>
            )}
            {role === "client" && <span className="badge bg-sky-50 text-sky-700" data-testid="client-badge">Client reviewer</span>}
            <span className="text-zinc-500">
              {workspace.name} ·{" "}
              {!trial.enabled ? (
                <span className="badge bg-emerald-50 text-emerald-700">Free plan</span>
              ) : trial.active ? (
                <span className="badge bg-emerald-50 text-emerald-700">Free trial · {trial.daysLeft} days left</span>
              ) : (
                <span className="badge bg-red-50 text-red-700">Trial ended</span>
              )}
            </span>
            <span className="text-zinc-400">|</span>
            <span>{user.name}</span>
            <form action={logoutAction}>
              <button className="text-zinc-500 hover:text-zinc-900">Log out</button>
            </form>
          </div>
        </div>
      </header>
      {!trial.active && (
        <div className="bg-red-50 px-6 py-2 text-center text-sm text-red-800">
          Your free trial has ended. Your content is safe, but new AI generation is paused.
        </div>
      )}
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
