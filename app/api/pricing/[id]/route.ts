import { NextRequest, NextResponse } from "next/server";
import iconv from "iconv-lite";
import { getUserFromRequest } from "@/lib/server/auth";
import { addPricingLog, getPricingSheetById } from "@/lib/server/store";
import { PricingColumn, PricingSheet, PricingVersion } from "@/types";

export const runtime = "nodejs";

const COMMON_MOJIBAKE_MAP: Record<string, string> = {
  "涓昏〃淇℃伅": "主表信息",
  "棣栫増": "首版",
  "鏄庣粏鐗╂枡瀵规瘮": "明细物料对比",
  "V3閲戦": "V3金额",
  "閲戦": "金额",
};

const scoreReadableChinese = (value: string) => {
  const cjkCount = (value.match(/[\u4e00-\u9fff]/g) || []).length;
  const replacement = (value.match(/�/g) || []).length;
  const suspicious = (value.match(/[鈥�鍒鍚鍙鍔鏄鏂鏉鏃鐗閲绛缁涓昏〃淇伅棣瀵瘮]/g) || []).length;
  return cjkCount - replacement * 8 - suspicious * 2;
};

const fixMojibake = (value: string) => {
  let text = String(value || "");
  if (!text) return text;
  for (const [bad, good] of Object.entries(COMMON_MOJIBAKE_MAP)) {
    if (text.includes(bad)) text = text.replaceAll(bad, good);
  }
  try {
    const converted = iconv.decode(iconv.encode(text, "gbk"), "utf8");
    if (!converted || converted === text) return text;
    return scoreReadableChinese(converted) > scoreReadableChinese(text) ? converted : text;
  } catch {
    return text;
  }
};

const fixColumns = (columns: PricingColumn[] | undefined) => {
  if (!Array.isArray(columns)) return columns;
  return columns.map((column) => ({
    ...column,
    label: fixMojibake(column.label || ""),
  }));
};

const fixVersion = (version: PricingVersion): PricingVersion => ({
  ...version,
  fileName: fixMojibake(version.fileName || ""),
  columns: fixColumns(version.columns) || [],
});

const fixSheetText = (sheet: PricingSheet): PricingSheet => ({
  ...sheet,
  key: fixMojibake(sheet.key || ""),
  name: fixMojibake(sheet.name || ""),
  mainColumns: fixColumns(sheet.mainColumns) || [],
  diffColumns: fixColumns(sheet.diffColumns) || [],
  versions: Array.isArray(sheet.versions) ? sheet.versions.map(fixVersion) : [],
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ message: "未登录" }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ message: "缺少ID" }, { status: 400 });
  }

  const sheet = await getPricingSheetById(id);
  if (!sheet) {
    return NextResponse.json({ message: "核价单不存在" }, { status: 404 });
  }

  const fixedSheet = fixSheetText(sheet);

  // Log view action (fire-and-forget)
  void addPricingLog({
    sheetId: fixedSheet.id,
    sheetKey: fixedSheet.key,
    action: "view",
    detail: `查看核价单: ${fixedSheet.name}`,
    userId: user.id,
    userName: user.name,
  });

  return NextResponse.json({ sheet: fixedSheet });
}
