import type { Metadata } from "next";
import { MavoAdminPanel, MavoMasterLogin } from "@/components/mavo-admin";
import { getMavoMasterAuthStatus, getMavoMasterSession } from "@/lib/mavo-master-auth";
import { getMavoSystemOverview } from "@/lib/mavo-system-overview";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Painel master",
  robots: { index: false, follow: false },
};

export default async function MavoPage() {
  const session = await getMavoMasterSession();
  if (!session) {
    return <MavoMasterLogin configured={getMavoMasterAuthStatus().configured} />;
  }

  const overview = await getMavoSystemOverview();
  return <MavoAdminPanel session={session} initialOverview={overview} />;
}
