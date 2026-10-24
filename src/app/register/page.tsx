import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { getAuth } from "@/lib/auth";

export default async function RegisterPage() {
  if (await getAuth()) redirect("/dashboard");
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <AuthForm mode="register" />
    </main>
  );
}
