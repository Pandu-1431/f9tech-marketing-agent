import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
import { JoinButton } from "@/components/join-button";
import { getSessionUser } from "@/lib/auth";
import { findOpenInvite, ROLE_LABELS } from "@/lib/team";

export const metadata = { title: "Invite · MarketingAgent" };

/** Public page behind an invite link. Logged in → "Join"; not logged in → sign up (or log in). */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await findOpenInvite(token);
  if (!found) {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <div className="card w-full max-w-md space-y-3">
          <h1 className="text-xl font-semibold">This invite link can&apos;t be used</h1>
          <p className="text-sm text-zinc-600">It has expired, was already used, or was cancelled. Ask the person who sent it for a new link.</p>
          <Link href="/login" className="btn-secondary inline-block">Go to log in</Link>
        </div>
      </main>
    );
  }
  const role = ROLE_LABELS[found.invite.role] ?? found.invite.role;
  const what =
    found.invite.role === "client"
      ? "You will be able to see their campaigns and approve or reject posts. You can't change content."
      : "You will be able to create and edit campaigns and business accounts.";
  const user = await getSessionUser();

  if (user) {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <div className="card w-full max-w-md space-y-3">
          <h1 className="text-xl font-semibold">Join {found.workspaceName}</h1>
          <p className="text-sm text-zinc-600">
            You&apos;re invited as <b>{role}</b>. {what}
          </p>
          <p className="text-sm text-zinc-500">Logged in as {user.email}.</p>
          <JoinButton token={token} label={`Join ${found.workspaceName}`} />
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <AuthForm
        mode="register"
        invite={token}
        title={`Join ${found.workspaceName}`}
        subtitle={`You're invited as ${role}. ${what}`}
      />
    </main>
  );
}
