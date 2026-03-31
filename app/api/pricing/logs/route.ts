import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/server/auth";
import { getPricingLogs } from "@/lib/server/store";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ message: "未登录" }, { status: 401 });
  }
  const url = new URL(request.url);
  const sheetId = url.searchParams.get("sheetId") || undefined;
  const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 200);
  const logs = await getPricingLogs(sheetId, limit);
  return NextResponse.json({ logs });
}
