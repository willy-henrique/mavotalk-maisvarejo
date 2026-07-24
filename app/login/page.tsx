import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { LoginForm } from "@/components/login-form";
import { canonicalFrontendLocation } from "@/lib/frontend-location";

export default async function LoginPage() {
  const canonicalFrontend = canonicalFrontendLocation("/");
  if (canonicalFrontend) {
    redirect(canonicalFrontend);
  }

  const session = await getSession();
  if (session) {
    redirect("/dashboard");
  }

  return (
    <main className="login-screen">
      <LoginForm />
    </main>
  );
}

