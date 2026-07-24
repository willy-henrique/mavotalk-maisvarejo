import { NextResponse } from "next/server";
import { z } from "zod";
import { getAgentConfiguration } from "@/lib/agent-cloud/agent-status-service";
import { authenticatedAgentPayload } from "../_shared";

export async function GET(request: Request) {
  const auth = await authenticatedAgentPayload(request, z.object({}).strict());
  if (!auth.ok) return auth.response;
  return NextResponse.json(getAgentConfiguration(auth.context));
}
