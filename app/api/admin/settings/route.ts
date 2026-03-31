import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/server/auth";
import { getAppSettings, updateAppSettings } from "@/lib/server/store";
import { AppSettings, ThemeOption } from "@/types";
const themeValues: ThemeOption[] = ["graphite", "ocean", "amber"];

export async function GET(request: NextRequest) {
  const me = getUserFromRequest(request);
  if (!me) {
    return NextResponse.json({ message: "未登录" }, { status: 401 });
  }
  if (me.role !== "admin") {
    return NextResponse.json({ message: "无权限" }, { status: 403 });
  }
  return NextResponse.json(getAppSettings());
}

export async function PATCH(request: NextRequest) {
  const me = getUserFromRequest(request);
  if (!me) {
    return NextResponse.json({ message: "未登录" }, { status: 401 });
  }
  if (me.role !== "admin") {
    return NextResponse.json({ message: "无权限" }, { status: 403 });
  }

  const body = (await request.json()) as Partial<AppSettings> | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ message: "参数不合法" }, { status: 400 });
  }
  if (body.theme && !themeValues.includes(body.theme)) {
    return NextResponse.json({ message: "主题不合法" }, { status: 400 });
  }

  const updated = updateAppSettings({ theme: body.theme });
  if (!updated) {
    return NextResponse.json({ message: "保存失败" }, { status: 400 });
  }
  return NextResponse.json(updated);
}
