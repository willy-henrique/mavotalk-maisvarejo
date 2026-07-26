import { redirect } from "next/navigation";
import { canonicalFrontendLocation } from "@/lib/frontend-location";

export default async function QueuesPage() {
  redirect(canonicalFrontendLocation("/admin/tipos") || "/mavo");
}
