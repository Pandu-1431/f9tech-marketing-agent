import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { getAuth } from "@/lib/auth";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const inviteNext = next && /^\/invite\/[A-Za-z0-9_-]{10,100}$/.test(next) ? next : undefined;
  if (!inviteNext && (await getAuth())) redirect("/dashboard");
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <AuthForm mode="login" next={inviteNext} subtitle={inviteNext ? "Log in to accept the invite." : undefined} />
    </main>
  );
}
