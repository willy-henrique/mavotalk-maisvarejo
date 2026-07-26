import { redirect } from "next/navigation";
import { canonicalFrontendLocation } from "@/lib/frontend-location";

export default async function HomePage() {
  redirect(canonicalFrontendLocation("/") || "/mavo");
}
