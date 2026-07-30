import { NextResponse } from "next/server";
import { requireMenuPermission, requireSession } from "@/lib/api";
import { createAuditLog } from "@/lib/repo";
import { createPromotion, listPromotions, type PromotionStatus } from "@/lib/commerce";
import { promotionSchema } from "@/lib/schemas";

export async function GET(request: Request) { const auth=await requireSession(); if(auth.error||!auth.session)return auth.error; const denied=await requireMenuPermission(auth.session,"admin_types","read"); if(denied)return denied; const url=new URL(request.url); const status=url.searchParams.get("status") as PromotionStatus | null; const promotions=await listPromotions(auth.session.organizationId,{status:status||undefined,page:Number(url.searchParams.get("page"))||1,pageSize:Number(url.searchParams.get("pageSize"))||25}); return NextResponse.json({promotions}); }
export async function POST(request:Request) { const auth=await requireSession(); if(auth.error||!auth.session)return auth.error; const denied=await requireMenuPermission(auth.session,"admin_types","create"); if(denied)return denied; const parsed=promotionSchema.safeParse(await request.json().catch(()=>null)); if(!parsed.success)return NextResponse.json({error:"Dados inválidos",details:parsed.error.flatten()},{status:422}); const promotion=await createPromotion(auth.session.organizationId,auth.session.userId,parsed.data); await createAuditLog(auth.session.organizationId,auth.session.userId,"create_promotion","promotion",promotion.id,{status:promotion.status}); return NextResponse.json({promotion},{status:201}); }
