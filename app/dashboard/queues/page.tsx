import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { QueueManager } from "@/components/queue-manager";
import { canonicalFrontendLocation } from "@/lib/frontend-location";

export default async function QueuesPage() {
  const canonicalFrontend = canonicalFrontendLocation("/admin/tipos");
  if (canonicalFrontend) {
    redirect(canonicalFrontend);
  }

  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return <QueueManager />;
}

