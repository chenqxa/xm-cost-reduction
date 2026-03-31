import { NextRequest } from "next/server";
import { getUserById } from "@/lib/server/store";

export const sessionCookieName = "pm_user";

export function getUserFromRequest(request: NextRequest) {
  const userId = request.cookies.get(sessionCookieName)?.value;
  if (!userId) return null;
  return getUserById(userId) || null;
}
