import { NextResponse } from "next/server";
import { sessionCookieName } from "@/lib/server/auth";

export async function POST() {
  const response = NextResponse.json({ success: true });
  response.cookies.set(sessionCookieName, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
