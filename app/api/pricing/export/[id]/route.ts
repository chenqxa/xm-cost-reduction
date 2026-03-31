import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getUserFromRequest } from "@/lib/server/auth";
import { getPricingSheetById, addPricingLog } from "@/lib/server/store";

export const runtime = "nodejs";

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

  const diffs = sheet.diffs || [];
  const diffColumns = sheet.diffColumns || [];

  // Build header row
  const headerRow: string[] = ["序号", "物料编码", "物料名称"];
  const extraKeys: string[] = [];
  for (const col of diffColumns) {
    const lbl = (col.label || "").toLowerCase();
    if (lbl.includes("编码") || lbl.includes("名称") || lbl.includes("code") || lbl.includes("name")) continue;
    headerRow.push(col.label || col.key);
    extraKeys.push(col.key);
  }
  headerRow.push("V1金额", "最新金额", "差异", "状态");

  const statusLabel = (s: string) =>
    ({ added: "新增", removed: "删除", changed: "变更", unchanged: "不变" }[s] || "不变");

  const dataRows = diffs.map((d, idx) => {
    const row: (string | number)[] = [idx + 1, d.materialCode, d.materialName];
    for (const key of extraKeys) {
      row.push(d.fields?.[key] || "");
    }
    row.push(
      d.basePrice ?? "",
      d.latestPrice ?? "",
      d.delta ?? "",
      statusLabel(d.status)
    );
    return row;
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows]);
  XLSX.utils.book_append_sheet(wb, ws, "对比结果");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  // Log export action
  void addPricingLog({
    sheetId: sheet.id,
    sheetKey: sheet.key,
    action: "export",
    detail: `导出对比结果: ${sheet.name}`,
    userId: user.id,
    userName: user.name,
  });

  const fileName = encodeURIComponent(`${sheet.name || sheet.key}_对比结果.xlsx`);
  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${fileName}`,
    },
  });
}
