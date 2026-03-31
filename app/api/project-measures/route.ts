import { NextRequest, NextResponse } from "next/server";
import sql from "mssql";
import { getUserFromRequest } from "@/lib/server/auth";
import { getProjectById, getProjectByIdFromSql } from "@/lib/server/store";
import { Project, User } from "@/types";

type ProjectMeasureRow = {
  mainid: string;
  zyxdcs: string;
  csms: string;
  lastname: string;
};

const canViewProject = (user: User, project: Project) => {
  if (user.role === "admin") return true;
  return project.departmentId === user.departmentId;
};

const getConnectionString = () =>
  process.env.XM_SQLSERVER_CONNECTION_STRING ||
  process.env.SQLSERVER_CONNECTION_STRING ||
  process.env.SQL_SERVER_CONNECTION_STRING ||
  "";

const normalizeSqlServerConnectionString = (connectionString: string) => {
  const trimmed = connectionString.trim().replace(/;+$/, "");
  if (!trimmed) return "";
  const parts = trimmed
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
  const hasEncrypt = parts.some((part) => part.toLowerCase().startsWith("encrypt="));
  const hasTrust = parts.some((part) => part.toLowerCase().startsWith("trustservercertificate="));
  const nextParts = [...parts];
  if (!hasEncrypt) nextParts.push("Encrypt=false");
  if (!hasTrust) nextParts.push("TrustServerCertificate=true");
  return `${nextParts.join(";")};`;
};

const globalForMeasureSql = globalThis as unknown as {
  __xmMeasureSqlPool?: sql.ConnectionPool;
  __xmMeasureSqlKey?: string;
};

const getMeasureSqlPool = async (connectionString: string) => {
  const existing = globalForMeasureSql.__xmMeasureSqlPool;
  if (existing && globalForMeasureSql.__xmMeasureSqlKey === connectionString) {
    return existing;
  }
  const normalized = normalizeSqlServerConnectionString(connectionString);
  const pool = new sql.ConnectionPool(normalized);
  pool.on("error", () => {
    globalForMeasureSql.__xmMeasureSqlPool = undefined;
    globalForMeasureSql.__xmMeasureSqlKey = undefined;
  });
  await pool.connect();
  globalForMeasureSql.__xmMeasureSqlPool = pool;
  globalForMeasureSql.__xmMeasureSqlKey = connectionString;
  return pool;
};

export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ message: "未登录" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const mainId = (searchParams.get("mainId") || "").trim();
  const altMainId = (searchParams.get("altMainId") || "").trim();
  const projectName = (searchParams.get("projectName") || "").trim();
  const salesOrderNo = (searchParams.get("salesOrderNo") || "").trim();
  if (!mainId) {
    return NextResponse.json({ message: "缺少项目ID" }, { status: 400 });
  }

  const projectByMainId = (await getProjectByIdFromSql(user, mainId)) ?? getProjectById(mainId);
  const projectByAltMainId = altMainId
    ? ((await getProjectByIdFromSql(user, altMainId)) ?? getProjectById(altMainId))
    : null;
  const project = projectByMainId ?? projectByAltMainId;
  if (project && !canViewProject(user, project)) {
    return NextResponse.json({ message: "无权限查看该项目" }, { status: 403 });
  }

  const connectionString = getConnectionString();
  if (!connectionString) {
    return NextResponse.json({ message: "未配置SQL Server连接字符串" }, { status: 500 });
  }

  try {
    const pool = await getMeasureSqlPool(connectionString);

    // 直接 JOIN 主表+明细+人员，用 LIKE 模糊匹配，不依赖精确字符串相等
    const resolvedProjectName = (projectName || String(project?.name || "")).trim();
    const resolvedSalesOrderNo = (salesOrderNo || String(project?.salesOrderNo || "")).trim();
    // 纯数字候选（formTemplateId 或 altMainId 若是数字则直接匹配 p.id）
    const formId = [altMainId, String(project?.formTemplateId || ""), mainId]
      .find((v) => v && /^\d+$/.test(v.trim())) || "";

    if (!resolvedProjectName && !resolvedSalesOrderNo && !formId) {
      return NextResponse.json({ measures: [], matchedMainIds: [] });
    }

    const req = pool.request();
    req.input("formId",       sql.NVarChar(64),  formId);
    req.input("projectName",  sql.NVarChar(200), resolvedProjectName);
    req.input("salesOrderNo", sql.NVarChar(256), resolvedSalesOrderNo);

    const result = await req.query(`
      SELECT TOP 300
        CAST(a.mainid AS NVARCHAR(64))   AS mainid,
        CAST(a.zyxdcs AS NVARCHAR(MAX))  AS zyxdcs,
        CAST(a.csms   AS NVARCHAR(MAX))  AS csms,
        CAST(b.lastname AS NVARCHAR(128)) AS lastname
      FROM FWsv.ecology.dbo.uf_costreductionprj_dt1 a
      INNER JOIN FWsv.ecology.dbo.uf_costreductionprj p
             ON a.mainid = p.id
      LEFT  JOIN FWsv.ecology.dbo.hrmresource b
             ON a.zrr = b.id
      WHERE
        (@formId <> '' AND CAST(p.id AS NVARCHAR(64)) = @formId)
        OR (@projectName <> ''
            AND LTRIM(RTRIM(CAST(p.xmmc AS NVARCHAR(200))))
                LIKE N'%' + @projectName + N'%')
        OR (@salesOrderNo <> ''
            AND LTRIM(RTRIM(CAST(p.xsddh AS NVARCHAR(256))))
                LIKE N'%' + @salesOrderNo + N'%')
      ORDER BY a.mainid
    `);

    const rows = Array.isArray(result.recordset)
      ? (result.recordset as unknown as ProjectMeasureRow[])
      : [];
    const resolvedMainIds = Array.from(new Set(rows.map((r) => String(r.mainid || "").trim()).filter(Boolean)));

    const measures = rows.map((row) => ({
      mainId: String(row.mainid || "").trim(),
      mainAction: String(row.zyxdcs || "").trim(),
      description: String(row.csms || "").trim(),
      responsiblePerson: String(row.lastname || "").trim(),
    }));

    return NextResponse.json({ measures, matchedMainIds: resolvedMainIds });
  } catch (error) {
    return NextResponse.json(
      { message: "获取实施措施失败", error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
