import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { canonicalFrontendLocation } from "@/lib/frontend-location";

export default async function HomePage() {
  const canonicalFrontend = canonicalFrontendLocation("/");
  if (canonicalFrontend) {
    redirect(canonicalFrontend);
  }

  const session = await getSession();
  if (session) {
    redirect("/dashboard");
  }

  redirect("/login");
}

