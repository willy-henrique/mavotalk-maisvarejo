import { NextResponse } from "next/server";
import { requireSupermarketAdmin } from "@/lib/supermarket-admin-auth";
import { getDeliverySettings, saveDeliverySettings } from "@/lib/commerce";
import { deliverySettingsSchema } from "@/lib/schemas";
import { createAuditLog } from "@/lib/repo";
export async function GET(request:Request){const auth=await requireSupermarketAdmin(request);if(auth.error||!auth.session)return auth.error;return NextResponse.json({settings:await getDeliverySettings(auth.session.organizationId)});}
export async function PATCH(request:Request){const auth=await requireSupermarketAdmin(request);if(auth.error||!auth.session)return auth.error;const parsed=deliverySettingsSchema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:"Dados inválidos",details:parsed.error.flatten()},{status:422});const settings=await saveDeliverySettings(auth.session.organizationId,parsed.data);await createAuditLog(auth.session.organizationId,auth.session.userId,"update_delivery_settings","delivery_settings",auth.session.organizationId,{active:settings.isActive});return NextResponse.json({settings});}
