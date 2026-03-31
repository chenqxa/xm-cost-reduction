import { NextResponse } from "next/server";
import { getUserByUsernameAndPassword } from "@/lib/server/store";
import { sessionCookieName } from "@/lib/server/auth";
import { logger } from "@/lib/server/logger";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { username, password } = body;
    if (!username || !password) {
      logger.warn("Login attempt with missing credentials");
      return NextResponse.json({ message: "缺少用户名或密码" }, { status: 400 });
    }
    const user = await getUserByUsernameAndPassword(username, password);
    if (!user) {
      logger.warn("Failed login attempt", { username });
      return NextResponse.json({ message: "用户名或密码错误" }, { status: 401 });
    }
    logger.info("User logged in successfully", { userId: user.id, username: user.username });
  const response = NextResponse.json({
    id: user.id,
    name: user.name,
    username: user.username,
    avatar: user.avatar,
    role: user.role,
    departmentId: user.departmentId,
    companyId: user.companyId,
  });
  
  const isProduction = process.env.NODE_ENV === "production";
  const maxAge = 7 * 24 * 60 * 60;
  
  response.cookies.set(sessionCookieName, user.id, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    maxAge,
  });
  return response;
  } catch (error) {
    logger.error("Login error", error instanceof Error ? error : new Error(String(error)));
    return NextResponse.json({ message: "登录失败，请稍后重试" }, { status: 500 });
  }
}
