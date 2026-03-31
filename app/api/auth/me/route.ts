import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/server/auth";

export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ message: "未登录" }, { status: 401 });
  }
  return NextResponse.json({
    id: user.id,
    name: user.name,
    username: user.username,
    avatar: user.avatar,
    role: user.role,
    departmentId: user.departmentId,
    companyId: user.companyId,
  });
}
