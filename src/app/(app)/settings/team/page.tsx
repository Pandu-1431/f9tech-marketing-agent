import { removeMemberAction, revokeInviteAction } from "@/app/actions/team";
import { InviteForm } from "@/components/invite-form";
import { requireOwner } from "@/lib/auth";
import { INVITE_DAYS, listMembers, listOpenInvites, ROLE_LABELS } from "@/lib/team";

export default async function TeamPage() {
  const { workspace, user } = await requireOwner();
  const [members, invites] = await Promise.all([listMembers(workspace.id), listOpenInvites(workspace.id)]);
  const date = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Team</h1>
        <p className="text-sm text-zinc-500">
          Invite a client to review posts, or a colleague to help make them. Client reviewers can see campaigns and approve or reject posts,
          but cannot change content or settings.
        </p>
      </div>

      <section className="card space-y-3">
        <h2 className="font-semibold">Invite someone</h2>
        <InviteForm days={INVITE_DAYS} />
      </section>

      <section className="card">
        <h2 className="mb-3 font-semibold">Members ({members.length})</h2>
        <ul className="divide-y divide-zinc-100" data-testid="members">
          {members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <div className="min-w-48 flex-1">
                <p className="font-medium">{m.name}{m.userId === user.id ? " (you)" : ""}</p>
                <p className="text-zinc-500">{m.email}</p>
              </div>
              <span className="badge bg-zinc-100 text-zinc-700">{ROLE_LABELS[m.role] ?? m.role}</span>
              <span className="text-xs text-zinc-500">since {date(m.since)}</span>
              {m.role !== "owner" && (
                <form action={removeMemberAction.bind(null, m.id)}>
                  <button className="text-xs text-red-600 hover:underline">Remove</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2 className="mb-3 font-semibold">Open invites ({invites.length})</h2>
        {invites.length === 0 ? (
          <p className="text-sm text-zinc-500">No open invites.</p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {invites.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <p className="min-w-48 flex-1">{i.label || "Invite link"}</p>
                <span className="badge bg-zinc-100 text-zinc-700">{ROLE_LABELS[i.role] ?? i.role}</span>
                <span className="text-xs text-zinc-500">expires {date(i.expiresAt)}</span>
                <form action={revokeInviteAction.bind(null, i.id)}>
                  <button className="text-xs text-red-600 hover:underline">Cancel invite</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
