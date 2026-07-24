import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { DashboardClient } from "@/components/dashboard-client";
import { canonicalFrontendLocation } from "@/lib/frontend-location";

export default async function DashboardPage() {
  const canonicalFrontend = canonicalFrontendLocation("/inbox");
  if (canonicalFrontend) {
    redirect(canonicalFrontend);
  }

  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return <DashboardClient />;
}

