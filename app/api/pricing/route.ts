import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import * as XLSX from "xlsx";
import { getUserFromRequest } from "@/lib/server/auth";
import { addPricingVersion, getPricingSheetList, addPricingLog } from "@/lib/server/store";
import { PricingColumn, PricingItem } from "@/types";

export const runtime = "nodejs";

const normalizeKey = (value: string) => value.replace(/\s+/g, "").toLowerCase();

const matchHeaderIndex = (cells: string[], candidates: string[]) => {
  const normalizedCandidates = candidates.map((c) => normalizeKey(c));
  for (let i = 0; i < cells.length; i += 1) {
    const key = normalizeKey(cells[i] || "");
    if (!key) continue;
    if (normalizedCandidates.some((c) => key === c || key.includes(c))) return i;
  }
  return -1;
};

const scoreHeader = (cell: string, keywords: Array<{ key: string; score: number }>) => {
  const normalized = normalizeKey(cell || "");
  if (!normalized) return 0;
  let score = 0;
  for (const keyword of keywords) {
    if (normalized.includes(keyword.key)) score += keyword.score;
  }
  return score;
};

const pickBestColumn = (cells: string[], keywords: Array<{ key: string; score: number }>) => {
  let bestIndex = -1;
  let bestScore = 0;
  for (let i = 0; i < cells.length; i += 1) {
    const score = scoreHeader(cells[i], keywords);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  return bestIndex;
};

const buildColumns = (headerCells: string[], columnCount: number) => {
  return Array.from({ length: columnCount }).map((_, index) => {
    const label = headerCells[index] || "";
    const text = String(label || "").trim();
    return {
      key: `c_${index}`,
      label: text || `字段${index + 1}`,
    };
  });
};

const buildAutoSheetKey = (params: {
  inputKey: string;
  fileName: string;
  primaryCode: string;
  primaryName: string;
  sheetName: string;
}) => {
  if (params.inputKey.trim()) return params.inputKey.trim();
  const normalizedPrimaryCode = params.primaryCode.replace(/\s+/g, "").trim();
  if (normalizedPrimaryCode) return normalizedPrimaryCode;
  const pureFileName = params.fileName.replace(/\.[^.]+$/, "").trim();
  const raw = [params.primaryName, pureFileName, params.sheetName]
    .map((item) => item.trim())
    .filter(Boolean)
    .join("-");
  if (!raw) {
    return `AUTO-${Date.now()}`;
  }
  return raw.replace(/\s+/g, "");
};

const findPreviousNonEmptyRowIndex = (rows: string[][], startExclusive: number) => {
  for (let i = startExclusive - 1; i >= 0; i -= 1) {
    const hasValue = rows[i]?.some((cell) => String(cell || "").trim().length > 0);
    if (hasValue) return i;
  }
  return -1;
};

const findNextNonEmptyRowIndex = (rows: string[][], startInclusive: number, endExclusive: number) => {
  for (let i = startInclusive; i < endExclusive; i += 1) {
    const hasValue = rows[i]?.some((cell) => String(cell || "").trim().length > 0);
    if (hasValue) return i;
  }
  return -1;
};

const readNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const str = String(value ?? "").replace(/[,¥￥$€£\s]/g, "").trim();
  if (!str) return Number.NaN;
  const parsed = Number(str);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ message: "未登录" }, { status: 401 });
  }
  const url = new URL(request.url);
  const query = url.searchParams.get("q") || undefined;
  const projectId = url.searchParams.get("projectId") || undefined;
  const departmentId = user.role === "admin" ? undefined : user.departmentId;
  const items = await getPricingSheetList(departmentId, query, projectId);
  return NextResponse.json({ items });
}

export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ message: "未登录" }, { status: 401 });
  }
  const formData = await request.formData();
  const sheetKey = String(formData.get("sheetKey") || "").trim();
  const sheetName = String(formData.get("sheetName") || "").trim();
  const projectId = String(formData.get("projectId") || "").trim() || undefined;
  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ message: "缺少Excel文件" }, { status: 400 });
  }
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const fileHash = crypto.createHash("sha256").update(buffer).digest("hex");
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetNameToUse = workbook.SheetNames[0];
  if (!sheetNameToUse) {
    return NextResponse.json({ message: "Excel内容为空" }, { status: 400 });
  }
  const worksheet = workbook.Sheets[sheetNameToUse];
  const rowMatrix = XLSX.utils.sheet_to_json<string[]>(worksheet, { header: 1, defval: "" });
  if (rowMatrix.length === 0) {
    return NextResponse.json({ message: "Excel没有数据行" }, { status: 400 });
  }
  const sheetRange = worksheet["!ref"] ? XLSX.utils.decode_range(worksheet["!ref"]) : null;
  const matrixColumnCount = Math.max(...rowMatrix.map((row) => row.length), 0);
  const totalColumnCount = Math.max(sheetRange ? sheetRange.e.c + 1 : 0, matrixColumnCount, 1);
  // 调试：输出前几行的内容
  console.log(`[pricing] Excel文件: ${file.name}, 工作表: ${sheetNameToUse}, 总行数: ${rowMatrix.length}, 总列数: ${totalColumnCount}`);
  console.log(`[pricing] 前5行内容:`, rowMatrix.slice(0, 5).map((row, idx) => ({
    row: idx + 1,
    cells: row.map((cell) => String(cell || "").trim()),
    cellCount: row.length
  })));

  const headerCandidates = rowMatrix
    .map((row, index) => {
      const cells = row.map((cell) => String(cell || "").trim());
      const codeIndex = matchHeaderIndex(cells, ["物料编码", "物料代码", "料号", "materialcode", "material_code", "编码"]);
      const nameIndex = matchHeaderIndex(cells, ["物料名称", "名称", "materialname", "material_name", "品名"]);
      const amountIndex = pickBestColumn(cells, [
        { key: normalizeKey("含税金额"), score: 10 },
        { key: normalizeKey("不含税金额"), score: 10 },
        { key: normalizeKey("本币金额"), score: 10 },
        { key: normalizeKey("物料金额"), score: 9 },
        { key: normalizeKey("材料金额"), score: 9 },
        { key: normalizeKey("采购金额"), score: 9 },
        { key: normalizeKey("总金额"), score: 9 },
        { key: normalizeKey("金额"), score: 8 },
        { key: normalizeKey("金额(元)"), score: 8 },
        { key: normalizeKey("totalamount"), score: 8 },
        { key: normalizeKey("amount"), score: 7 },
      ]);
      const unitPriceIndex = pickBestColumn(cells, [
        { key: normalizeKey("含税单价"), score: 10 },
        { key: normalizeKey("不含税单价"), score: 10 },
        { key: normalizeKey("材料单价"), score: 9 },
        { key: normalizeKey("采购单价"), score: 9 },
        { key: normalizeKey("单价"), score: 8 },
        { key: normalizeKey("核价"), score: 7 },
        { key: normalizeKey("价格"), score: 7 },
        { key: normalizeKey("unitprice"), score: 7 },
        { key: normalizeKey("price"), score: 6 },
      ]);
      const hasDetailMarker =
        matchHeaderIndex(cells, ["层次", "明细", "物料属性", "使用状态", "是否禁用", "单位"]) >= 0;
      
      // 调试：输出每一行的匹配结果
      if (cells.some(cell => cell)) {
        console.log(`[pricing] 行${index + 1}:`, {
          cells,
          codeIndex,
          nameIndex,
          amountIndex,
          unitPriceIndex,
          hasDetailMarker,
          codeCell: codeIndex >= 0 ? cells[codeIndex] : "未找到",
          amountCell: amountIndex >= 0 ? cells[amountIndex] : "未找到",
          priceCell: unitPriceIndex >= 0 ? cells[unitPriceIndex] : "未找到"
        });
      }
      
      return { index, cells, codeIndex, nameIndex, amountIndex, unitPriceIndex, hasDetailMarker };
    })
    .filter((item) => item.codeIndex >= 0 && (item.amountIndex >= 0 || item.unitPriceIndex >= 0));

  console.log(`[pricing] 找到 ${headerCandidates.length} 个有效的表头候选行`);

  if (headerCandidates.length === 0) {
    // 更详细的错误信息
    const allRowsWithContent = rowMatrix
      .map((row, index) => ({
        index,
        cells: row.map((cell) => String(cell || "").trim()),
        hasContent: row.some(cell => String(cell || "").trim())
      }))
      .filter(row => row.hasContent);
    
    console.log(`[pricing] 所有包含内容的行:`, allRowsWithContent);
    
    return NextResponse.json({ 
      message: "未识别到物料编码或金额/单价列。请确保Excel包含以下列：物料编码（或物料代码、料号、编码）以及金额（或单价）列。", 
      details: {
        totalRows: rowMatrix.length,
        contentRows: allRowsWithContent.length,
        sampleRows: allRowsWithContent.slice(0, 3).map(r => r.cells)
      }
    }, { status: 400 });
  }

  const detailHeader =
    headerCandidates.find((item, idx) => idx > 0 && item.hasDetailMarker) ||
    headerCandidates.at(-1) ||
    headerCandidates[0];
  const mainHeaderCandidates = rowMatrix
    .slice(0, detailHeader.index)
    .map((row, index) => {
      const cells = row.map((cell) => String(cell || "").trim());
      const codeIndex = matchHeaderIndex(cells, ["物料编码", "物料代码", "料号", "materialcode", "material_code", "编码"]);
      const nameIndex = matchHeaderIndex(cells, ["物料名称", "名称", "materialname", "material_name", "品名"]);
      const hasValue = cells.some((cell) => cell);
      return { index, cells, codeIndex, nameIndex, hasValue };
    })
    .filter((item) => item.hasValue && (item.codeIndex >= 0 || item.nameIndex >= 0));
  const mainHeaderRowIndex = mainHeaderCandidates.at(-1)?.index ?? -1;
  const mainDataRowIndex = mainHeaderRowIndex >= 0
    ? findNextNonEmptyRowIndex(rowMatrix, mainHeaderRowIndex + 1, detailHeader.index)
    : findPreviousNonEmptyRowIndex(rowMatrix, detailHeader.index);
  const mainHeaderCells =
    mainHeaderRowIndex >= 0
      ? rowMatrix[mainHeaderRowIndex].map((cell) => String(cell || "").trim())
      : detailHeader.cells;
  let mainColumns: PricingColumn[] = buildColumns(mainHeaderCells, totalColumnCount);
  const columns: PricingColumn[] = buildColumns(detailHeader.cells, totalColumnCount);
  const codeColumnKey = `c_${detailHeader.codeIndex}`;
  const nameColumnKey = detailHeader.nameIndex >= 0 ? `c_${detailHeader.nameIndex}` : "";
  const qtyIndex = matchHeaderIndex(detailHeader.cells, ["数量", "用量", "qty", "数量(个)", "采购数量"]);

  let droppedMissingCode = 0;
  let amountFallbackToZero = 0;
  const detailRows = rowMatrix.slice(detailHeader.index + 1);
  console.log(`[pricing] 明细表头行索引: ${detailHeader.index}, 明细数据行数: ${detailRows.length}`);
  console.log(`[pricing] 使用的列映射: 物料编码=${codeColumnKey}, 物料名称=${nameColumnKey}, 金额列=${detailHeader.amountIndex >= 0 ? detailHeader.amountIndex : '无'}, 单价列=${detailHeader.unitPriceIndex >= 0 ? detailHeader.unitPriceIndex : '无'}`);
  
  // 调试：输出前几行明细数据
  console.log(`[pricing] 前5行明细数据:`, detailRows.slice(0, 5).map((row, idx) => ({
    row: idx + 1,
    cells: row.map((cell) => String(cell || "").trim()),
    materialCode: row[detailHeader.codeIndex] || "",
    amount: detailHeader.amountIndex >= 0 ? row[detailHeader.amountIndex] : "",
    unitPrice: detailHeader.unitPriceIndex >= 0 ? row[detailHeader.unitPriceIndex] : ""
  })));
  
  const items = detailRows
    .map((row, rowIndex) => {
      const cells = row.map((cell) => String(cell || "").trim());
      const fields: Record<string, string> = {};
      columns.forEach((column, index) => {
        fields[column.key] = cells[index] || "";
      });
      const materialCode = fields[codeColumnKey] || "";
      const materialName = nameColumnKey ? fields[nameColumnKey] || "" : "";
      if (!materialCode) {
        droppedMissingCode += 1;
        console.log(`[pricing] 第${detailHeader.index + rowIndex + 2}行物料编码为空，跳过`);
        return null;
      }
      const rawAmount = detailHeader.amountIndex >= 0 ? readNumber(row[detailHeader.amountIndex]) : NaN;
      const rawUnitPrice = detailHeader.unitPriceIndex >= 0 ? readNumber(row[detailHeader.unitPriceIndex]) : NaN;
      const qty = qtyIndex >= 0 ? readNumber(row[qtyIndex]) : NaN;
      const parsedAmount = Number.isFinite(rawAmount)
        ? rawAmount
        : (Number.isFinite(rawUnitPrice) && Number.isFinite(qty) ? rawUnitPrice * qty : rawUnitPrice);
      const amount = Number.isFinite(parsedAmount) ? parsedAmount : 0;
      if (!Number.isFinite(parsedAmount)) amountFallbackToZero += 1;
      
      // 调试：输出解析结果
      if (rowIndex < 5) {
        console.log(`[pricing] 第${detailHeader.index + rowIndex + 2}行解析结果:`, {
          materialCode,
          materialName,
          rawAmount,
          rawUnitPrice,
          qty,
          parsedAmount,
          amount
        });
      }
      
      return { materialCode, materialName, amount, price: Number.isFinite(rawUnitPrice) ? rawUnitPrice : undefined, fields };
    })
    .filter((item) => Boolean(item)) as PricingItem[];
  
  console.log(`[pricing] 解析完成: 有效物料${items.length}条, 跳过空编码${droppedMissingCode}条, 金额解析失败${amountFallbackToZero}条`);
  
  if (items.length === 0) {
    return NextResponse.json({ 
      message: "未解析到有效物料行。请检查数据行是否包含有效的物料编码和金额信息。", 
      details: {
        totalDetailRows: detailRows.length,
        droppedMissingCode,
        amountFallbackToZero,
        sampleFailedRows: detailRows.slice(0, 3).map((row, idx) => ({
          row: idx + 1,
          cells: row.map((cell) => String(cell || "").trim()),
          materialCode: row[detailHeader.codeIndex] || "",
          hasValidCode: Boolean(row[detailHeader.codeIndex])
        }))
      }
    }, { status: 400 });
  }
  console.log(`[pricing] Parsed ${items.length}/${detailRows.length} items | dropped code-empty: ${droppedMissingCode} | amount fallback zero: ${amountFallbackToZero} | amount col: "${detailHeader.amountIndex >= 0 ? detailHeader.cells[detailHeader.amountIndex] : "-"}" (idx ${detailHeader.amountIndex}) | unit price col: "${detailHeader.unitPriceIndex >= 0 ? detailHeader.cells[detailHeader.unitPriceIndex] : "-"}" (idx ${detailHeader.unitPriceIndex}) | code col: "${detailHeader.cells[detailHeader.codeIndex]}" (idx ${detailHeader.codeIndex}) | sample amounts: ${items.slice(0, 3).map(i => `${i.materialCode}=${i.amount}`).join(", ")}`);
  const mainDataCells = (
    rowMatrix[mainDataRowIndex >= 0 ? mainDataRowIndex : detailHeader.index + 1] || []
  ).map((cell) => String(cell || "").trim());
  let mainFields: Record<string, string> = {};
  mainColumns.forEach((column, index) => {
    mainFields[column.key] = mainDataCells[index] || "";
  });
  const mainCodeIndex = matchHeaderIndex(mainHeaderCells, [
    "物料编码",
    "物料代码",
    "料号",
    "materialcode",
    "material_code",
    "编码",
  ]);
  const mainNameIndex = matchHeaderIndex(mainHeaderCells, ["物料名称", "名称", "materialname", "material_name", "品名"]);
  const mainCodeKey = mainCodeIndex >= 0 ? `c_${mainCodeIndex}` : "";
  const mainNameKey = mainNameIndex >= 0 ? `c_${mainNameIndex}` : "";
  const mainHasValue = Object.values(mainFields).some((value) => String(value || "").trim().length > 0);
  if (!mainHasValue) {
    mainColumns = columns;
    mainFields = items[0]?.fields || {};
  }
  const primaryCode = mainFields[mainCodeKey] || items[0]?.materialCode || "";
  const primaryName =
    (mainNameKey ? mainFields[mainNameKey] : "") || items[0]?.materialName || "";
  const effectiveSheetKey = buildAutoSheetKey({
    inputKey: sheetKey,
    fileName: file.name,
    primaryCode,
    primaryName,
    sheetName: sheetNameToUse,
  });
  const result = await addPricingVersion({
    key: effectiveSheetKey,
    name: sheetName,
    projectId,
    fileHash,
    fileName: file.name,
    uploadedBy: user.id,
    uploadedByName: user.name,
    departmentId: user.departmentId,
    mainColumns,
    mainFields,
    columns,
    items,
  });
  if (result.status === "invalid") {
    return NextResponse.json({ message: "核价单编号无效" }, { status: 400 });
  }
  // Log the action
  void addPricingLog({
    sheetId: result.sheet?.id,
    sheetKey: effectiveSheetKey,
    action: result.status === "created" ? "create" : "upload_version",
    detail: `上传文件: ${file.name}`,
    userId: user.id,
    userName: user.name,
  });
  return NextResponse.json({
    status: result.status,
    sheetKey: effectiveSheetKey,
    sheet: result.sheet,
    parseInfo: {
      detailHeaderRow: detailHeader.index,
      amountColumn: detailHeader.amountIndex >= 0 ? { index: detailHeader.amountIndex, label: detailHeader.cells[detailHeader.amountIndex] || "" } : undefined,
      priceColumn: detailHeader.unitPriceIndex >= 0 ? { index: detailHeader.unitPriceIndex, label: detailHeader.cells[detailHeader.unitPriceIndex] || "" } : undefined,
      codeColumn: { index: detailHeader.codeIndex, label: detailHeader.cells[detailHeader.codeIndex] || "" },
      itemCount: items.length,
      totalDetailRows: detailRows.length,
      droppedMissingCode,
      amountFallbackToZero,
      sampleItems: items.slice(0, 5).map(i => ({ code: i.materialCode, name: i.materialName, amount: i.amount, price: i.price })),
    },
  });
}
