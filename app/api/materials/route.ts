import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/server/auth";
import { getAppSettings } from "@/lib/server/store";
import sql from "mssql";

export const runtime = "nodejs";

type MaterialItem = {
  entryId: string;
  materialCode: string;
  materialName: string;
  quantity: number;
  unit: string;
  unitPrice: number;
};

type TraceBomRow = {
  FBOMNumber: string;
  FNumber: string;
  FName: string;
  FAuxQty: number;
  FAudDate: string;
};

const readString = (value: unknown) => {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
};

const readNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const sanitizeSqlMessage = (message: string) =>
  message
    .replace(/password\s*=\s*[^;]+/gi, "password=***")
    .replace(/user\s*id\s*=\s*[^;]+/gi, "user id=***")
    .replace(/uid\s*=\s*[^;]+/gi, "uid=***")
    .replace(/pwd\s*=\s*[^;]+/gi, "pwd=***");

const formatSqlErrorMessage = (error: unknown) => {
  const raw = typeof error === "object" && error && "message" in error ? String((error as { message?: unknown }).message || "") : "";
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code || "") : "";
  const cleaned = raw ? sanitizeSqlMessage(raw) : "";
  if (code.includes("ETIMEOUT")) return "SQL Server 连接超时，请检查网络或服务器是否可达";
  if (code.includes("ELOGIN")) return "SQL Server 登录失败，请检查账号或密码";
  if (code.includes("ESOCKET")) return "SQL Server 连接中断，请检查网络稳定性";
  if (code.includes("EHOST")) return "SQL Server 地址不可达，请检查服务器地址或端口";
  if (cleaned) return `SQL Server 连接失败：${cleaned}`;
  return "SQL Server 连接失败";
};

const normalizeSqlServerConnectionString = (connectionString: string) => {
  const trimmed = connectionString.trim().replace(/;+$/, "");
  if (!trimmed) return "";
  const parts = trimmed.split(";").map((part) => part.trim()).filter(Boolean);
  const hasEncrypt = parts.some((part) => part.toLowerCase().startsWith("encrypt="));
  const hasTrust = parts.some((part) => part.toLowerCase().startsWith("trustservercertificate="));
  const nextParts = [...parts];
  if (!hasEncrypt) nextParts.push("Encrypt=false");
  if (!hasTrust) nextParts.push("TrustServerCertificate=true");
  return `${nextParts.join(";")};`;
};

const globalForSqlServer = globalThis as unknown as {
  __xmSqlServerPool?: sql.ConnectionPool;
  __xmSqlServerKey?: string;
};

const getSqlServerPool = async (connectionString: string) => {
  const existing = globalForSqlServer.__xmSqlServerPool;
  if (existing && globalForSqlServer.__xmSqlServerKey === connectionString) {
    try {
      await existing.request().query("SELECT 1");
      return existing;
    } catch {
      globalForSqlServer.__xmSqlServerPool = undefined;
      globalForSqlServer.__xmSqlServerKey = undefined;
      try {
        await existing.close();
      } catch {
        globalForSqlServer.__xmSqlServerPool = undefined;
        globalForSqlServer.__xmSqlServerKey = undefined;
      }
    }
  }

  const normalized = normalizeSqlServerConnectionString(connectionString);
  const pool = new sql.ConnectionPool(normalized);
  pool.on("error", () => {
    globalForSqlServer.__xmSqlServerPool = undefined;
    globalForSqlServer.__xmSqlServerKey = undefined;
  });
  globalForSqlServer.__xmSqlServerPool = pool;
  globalForSqlServer.__xmSqlServerKey = connectionString;
  await pool.connect();
  return pool;
};

const resetSqlServerPool = async () => {
  const existing = globalForSqlServer.__xmSqlServerPool;
  globalForSqlServer.__xmSqlServerPool = undefined;
  globalForSqlServer.__xmSqlServerKey = undefined;
  if (existing) {
    try {
      await existing.close();
    } catch {}
  }
};

const withSqlServerPool = async <T,>(connectionString: string, handler: (pool: sql.ConnectionPool) => Promise<T>) => {
  try {
    const pool = await getSqlServerPool(connectionString);
    return await handler(pool);
  } catch {
    await resetSqlServerPool();
    const pool = await getSqlServerPool(connectionString);
    return await handler(pool);
  }
};

const toMaterialItem = (raw: unknown): MaterialItem | null => {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const entryId = readString(record.entryId || record.FItemID || record.fitemid || record.FMaterialID || record.fmaterialid);
  const materialCode = readString(
    record.materialCode ||
      record.code ||
      record.material_code ||
      record.FNumber ||
      record.fnumber
  );
  const materialName = readString(
    record.materialName ||
      record.name ||
      record.material_name ||
      record.FName ||
      record.fname
  );
  const quantity = readNumber(record.quantity || record.qty || record.FQty || record.fqty);
  const unit = readString(record.unit || record.FUnit || record.funit) || "件";
  const unitPrice = readNumber(record.unitPrice || record.price || record.FStandardCost || record.fstandardcost);
  if (!materialCode && !materialName) return null;
  return { entryId, materialCode, materialName, quantity, unit, unitPrice };
};

export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ message: "未登录" }, { status: 401 });
  }

  const url = new URL(request.url);
  const query = url.searchParams.get("query") || url.searchParams.get("q") || "";
  const itemId = url.searchParams.get("itemId") || "";

  const settings = getAppSettings();
  const envConnectionString =
    process.env.XM_SQLSERVER_CONNECTION_STRING ||
    process.env.SQL_SERVER_CONNECTION_STRING ||
    process.env.SQLSERVER_CONNECTION_STRING ||
    "";
  const envTable =
    process.env.XM_SQLSERVER_MATERIALS_TABLE ||
    process.env.SQL_SERVER_MATERIALS_TABLE ||
    process.env.SQLSERVER_MATERIALS_TABLE ||
    "t_ICItem";
  const envMaterialsQuery =
    process.env.XM_SQLSERVER_MATERIALS_SQL ||
    process.env.SQL_SERVER_MATERIALS_SQL ||
    process.env.SQLSERVER_MATERIALS_SQL ||
    "";
  const envUpstreamUrl =
    process.env.XM_MATERIALS_API_URL ||
    process.env.MATERIALS_DB_API_URL ||
    "";

  const settingsSqlServer = settings?.forms?.sqlServer;
  const source = settings?.forms?.source || "local";
  const hasSqlServerConfig = Boolean(settingsSqlServer?.connectionString?.trim());
  const hasEnvSqlServerConfig = Boolean(envConnectionString.trim());
  const effectiveSource =
    source === "local" && (hasSqlServerConfig || hasEnvSqlServerConfig) ? "sqlserver" : source;

  try {
    if (itemId) {
      if (effectiveSource === "local") {
        const mock: TraceBomRow[] = [
          {
            FBOMNumber: "BOM-1001",
            FNumber: "PRD-001",
            FName: "主控制箱",
            FAuxQty: 1,
            FAudDate: new Date().toISOString(),
          },
        ];
        return NextResponse.json({ boms: mock });
      }
      if (effectiveSource === "upstream") {
        const upstreamUrl = envUpstreamUrl || settings?.forms?.upstream?.url || "";
        if (!upstreamUrl) {
          return NextResponse.json({ message: "物料数据源未配置" }, { status: 500 });
        }
        const targetUrl = new URL(upstreamUrl);
        targetUrl.searchParams.set("itemId", itemId);
        targetUrl.searchParams.set("trace", "1");
        const headers: Record<string, string> = {};
        const upstreamKey = settings?.forms?.upstream?.apiKey;
        if (upstreamKey) headers.Authorization = `Bearer ${upstreamKey}`;
        const upstreamResponse = await fetch(targetUrl.toString(), { headers, cache: "no-store" });
        if (!upstreamResponse.ok) {
          return NextResponse.json({ message: "加载关联BOM失败" }, { status: upstreamResponse.status });
        }
        const data = await upstreamResponse.json();
        return NextResponse.json(data);
      }
      const sqlServer = hasSqlServerConfig
        ? settingsSqlServer
        : {
            connectionString: envConnectionString,
            table: "ICBom",
            limit: Number(process.env.XM_SQLSERVER_FORMS_LIMIT || "50") || 50,
          };
      if (!sqlServer?.connectionString?.trim()) {
        return NextResponse.json({ message: "物料数据源未配置，请在系统设置中完善连接信息" }, { status: 500 });
      }
      const connectionString = sqlServer.connectionString.trim();
      const records = await withSqlServerPool(connectionString, async (pool) => {
        const request = pool.request().input("itemId", sql.NVarChar, itemId);
        const result = await request.query(
          `WITH child AS (
             SELECT CAST(FInterID AS NVARCHAR(128)) AS FInterID
             FROM ICBomChild
             WHERE CAST(FItemID AS NVARCHAR(128)) = @itemId
             UNION
             SELECT CAST(FInterID AS NVARCHAR(128)) AS FInterID
             FROM ICCustBomChild
             WHERE CAST(FItemID AS NVARCHAR(128)) = @itemId
           )
           SELECT DISTINCT
             CAST(bom.FBOMNumber AS NVARCHAR(128)) AS FBOMNumber,
             CAST(bom.FNumber AS NVARCHAR(256)) AS FNumber,
             CAST(bom.FName AS NVARCHAR(512)) AS FName,
             bom.FAuxQty AS FAuxQty,
             bom.FAudDate AS FAudDate
           FROM child
           INNER JOIN ICBom AS bom
             ON bom.FInterID = child.FInterID
           ORDER BY bom.FAudDate DESC`
        );
        return result.recordset || [];
      });
      const normalized: TraceBomRow[] = (records as unknown[]).map((row) => {
        const r = row as Record<string, unknown>;
        return {
          FBOMNumber: readString(r.FBOMNumber),
          FNumber: readString(r.FNumber),
          FName: readString(r.FName),
          FAuxQty: readNumber(r.FAuxQty),
          FAudDate: (() => {
            const v = r.FAudDate;
            if (v instanceof Date) return v.toISOString();
            if (typeof v === "string" && v.trim()) return v;
            return "";
          })(),
        };
      });
      return NextResponse.json({ boms: normalized });
    }

    if (effectiveSource === "local") {
      const seed = query.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0) || 12;
      const materials: MaterialItem[] = [
        {
          entryId: "1",
          materialCode: `MAT-${(seed % 90) + 10}`,
          materialName: "标准件",
          quantity: 1,
          unit: "件",
          unitPrice: 8 + (seed % 5),
        },
        {
          entryId: "2",
          materialCode: `MAT-${(seed % 80) + 20}`,
          materialName: "外协件",
          quantity: 1,
          unit: "件",
          unitPrice: 30 + (seed % 10),
        },
        {
          entryId: "3",
          materialCode: `MAT-${(seed % 70) + 30}`,
          materialName: "结构件",
          quantity: 1,
          unit: "件",
          unitPrice: 18 + (seed % 7),
        },
      ].filter((item) =>
        query ? `${item.materialCode}${item.materialName}`.toLowerCase().includes(query.toLowerCase()) : true
      );
      return NextResponse.json({ items: materials });
    }

    if (effectiveSource === "upstream") {
      const upstreamUrl = envUpstreamUrl || settings?.forms?.upstream?.url || "";
      if (!upstreamUrl) {
        return NextResponse.json({ message: "物料数据源未配置" }, { status: 500 });
      }
      const targetUrl = new URL(upstreamUrl);
      targetUrl.searchParams.set("query", query);
      const headers: Record<string, string> = {};
      const upstreamKey = settings?.forms?.upstream?.apiKey;
      if (upstreamKey) headers.Authorization = `Bearer ${upstreamKey}`;
      const upstreamResponse = await fetch(targetUrl.toString(), { headers, cache: "no-store" });
      if (!upstreamResponse.ok) {
        return NextResponse.json({ message: "加载物料失败" }, { status: upstreamResponse.status });
      }
      const data = await upstreamResponse.json();
      return NextResponse.json(data);
    }

    const sqlServer = hasSqlServerConfig
      ? settingsSqlServer
      : {
          connectionString: envConnectionString,
          table: envTable,
          limit: Number(process.env.XM_SQLSERVER_FORMS_LIMIT || "50") || 50,
        };
    if (!sqlServer?.connectionString?.trim()) {
      return NextResponse.json({ message: "物料数据源未配置，请在系统设置中完善连接信息" }, { status: 500 });
    }
    const connectionString = sqlServer.connectionString.trim();
    const table = envTable.trim() || "t_ICItem";
    const sqlLimit = sqlServer.limit || 50;
    const likeQuery = `%${query}%`;

    const materialRows = await withSqlServerPool(connectionString, async (pool) => {
      const request = pool
        .request()
        .input("limit", sql.Int, sqlLimit)
        .input("query", sql.NVarChar, query)
        .input("likeQuery", sql.NVarChar, likeQuery);
      const customSql = envMaterialsQuery.trim();
      const queryText = customSql
        ? customSql
        : `SELECT TOP (@limit)
            CAST(item.FItemID AS NVARCHAR(128)) AS entryId,
            CAST(item.FNumber AS NVARCHAR(256)) AS materialCode,
            CAST(item.FName AS NVARCHAR(512)) AS materialName,
            0 AS quantity,
            N'件' AS unit,
            0 AS unitPrice
          FROM ${table} AS item
          WHERE (@query = '' OR CAST(item.FNumber AS NVARCHAR(256)) LIKE @likeQuery OR CAST(item.FName AS NVARCHAR(512)) LIKE @likeQuery)
          ORDER BY item.FNumber`;
      const result = await request.query(queryText);
      return result.recordset || [];
    });
    const materials = materialRows
      .map((item) => toMaterialItem(item))
      .filter((item): item is MaterialItem => Boolean(item));
    return NextResponse.json({ items: materials });
  } catch (error) {
    return NextResponse.json({ message: formatSqlErrorMessage(error) }, { status: 500 });
  }
}
