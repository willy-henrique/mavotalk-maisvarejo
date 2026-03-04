import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { QueueManager } from "@/components/queue-manager";

export default async function QueuesPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return <QueueManager />;
}

