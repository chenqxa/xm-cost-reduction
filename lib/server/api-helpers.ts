import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "./auth";
import { User, UserRole } from "@/types";
import { logger } from "./logger";

export type ApiHandler<T = unknown> = (
  request: NextRequest,
  user: User,
  context?: T
) => Promise<NextResponse> | NextResponse;

export function withAuth(handler: ApiHandler) {
  return async (request: NextRequest, context?: unknown) => {
    try {
      const user = getUserFromRequest(request);
      if (!user) {
        logger.warn("Unauthorized API access attempt", { 
          path: request.nextUrl.pathname 
        });
        return NextResponse.json({ message: "未登录" }, { status: 401 });
      }
      return await handler(request, user, context);
    } catch (error) {
      logger.error(
        "API handler error",
        error instanceof Error ? error : new Error(String(error)),
        { path: request.nextUrl.pathname }
      );
      return NextResponse.json(
        { message: "服务器错误，请稍后重试" },
        { status: 500 }
      );
    }
  };
}

export function withRole(roles: UserRole[], handler: ApiHandler) {
  return withAuth(async (request, user, context) => {
    if (!roles.includes(user.role)) {
      logger.warn("Forbidden API access attempt", {
        userId: user.id,
        userRole: user.role,
        requiredRoles: roles,
        path: request.nextUrl.pathname,
      });
      return NextResponse.json({ message: "无权限访问" }, { status: 403 });
    }
    return await handler(request, user, context);
  });
}

export function withAdminRole(handler: ApiHandler) {
  return withRole(["admin"], handler);
}

export function withManagerRole(handler: ApiHandler) {
  return withRole(["admin", "manager"], handler);
}
