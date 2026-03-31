import { NextResponse } from "next/server";
import { getAppSettings } from "@/lib/server/store";

export async function GET() {
  const s = getAppSettings();
  return NextResponse.json({ theme: s.theme });
}
