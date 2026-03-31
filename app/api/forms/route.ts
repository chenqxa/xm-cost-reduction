import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/server/auth";
import { getAppSettings, getFormTemplateById, getFormTemplates } from "@/lib/server/store";
import sql from "mssql";

export const runtime = "nodejs";

type TemplateSummary = {
  id: string;
  name: string;
  code: string;
  bomNumber?: string;
  version?: string;
  createdAt: string;
};

type MaterialItem = {
  entryId: string;
  itemId?: string;
  materialCode: string;
  materialName: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  level?: number;
  parentId?: string;
  path?: string;
};

type ProjectFormFields = {
  name: string;
  initiator: string;
  problem: string;
  goal: string;
  actions: string;
  resources: string;
  cycle: string;
  benefit: string;
  approval: string;
};

const readString = (value: unknown) => {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
};

const readOptionalString = (value: unknown) => (typeof value === "string" ? value : undefined);

const readNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const readDateString = (value: unknown) => {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
  return new Date().toISOString();
};

const readRecordValue = (record: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    if (key in record) {
      const value = readString(record[key]);
      if (value) return value;
    }
  }
  return "";
};

const toProjectFormFields = (record: Record<string, unknown>): ProjectFormFields => ({
  name: readRecordValue(record, [
    "projectName",
    "ProjectName",
    "项目名称",
    "name",
    "FProjectName",
    "FName",
    "fname",
  ]),
  initiator: readRecordValue(record, [
    "initiator",
    "Initiator",
    "发起人",
    "FInitiator",
    "FStartBy",
    "FOriginator",
    "proposer",
    "Proposer",
  ]),
  problem: readRecordValue(record, [
    "problem",
    "Problem",
    "问题描述",
    "FProblem",
    "FDescribe",
    "FDescription",
  ]),
  goal: readRecordValue(record, [
    "goal",
    "Goal",
    "目标",
    "项目目标",
    "FGoal",
    "FTarget",
    "FExpect",
  ]),
  actions: readRecordValue(record, [
    "actions",
    "Actions",
    "行动措施",
    "FAction",
    "FMeasure",
    "FPlan",
  ]),
  resources: readRecordValue(record, [
    "resources",
    "Resources",
    "资源需求",
    "FResource",
    "FInput",
    "FNeeds",
  ]),
  cycle: readRecordValue(record, [
    "cycle",
    "Cycle",
    "周期",
    "项目周期",
    "FPeriod",
    "FDuration",
    "FStartDate",
    "FEndDate",
  ]),
  benefit: readRecordValue(record, [
    "benefit",
    "Benefit",
    "效益测算",
    "收益",
    "FBenefit",
    "FProfit",
    "FValue",
  ]),
  approval: readRecordValue(record, [
    "approval",
    "Approval",
    "审批意见",
    "FApproval",
    "FApprove",
    "FDecision",
  ]),
});

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

const toTemplateSummary = (raw: unknown): TemplateSummary | null => {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const id = readString(
    record.id ||
      record.templateId ||
      record.formId ||
      record.form_id ||
      record.template_id ||
      record.FBOMNumber ||
      record.fbomnumber
  );
  const name = readString(
    record.name ||
      record.title ||
      record.formName ||
      record.form_name ||
      record.FName ||
      record.fname
  );
  if (!id || !name) return null;
  const code = readString(
    record.code ||
      record.formCode ||
      record.form_code ||
      record.sn ||
      record.no ||
      record.FNumber ||
      record.fnumber
  );
  const bomNumber = readOptionalString(record.bomNumber || record.FBOMNumber || record.fbomnumber);
  const version = readOptionalString(record.version || record.formVersion || record.form_version);
  const createdAt = readDateString(
    record.createdAt ||
      record.created_at ||
      record.createTime ||
      record.createdTime ||
      record.FEntertime ||
      record.fentertime
  );
  return { id, name, code, bomNumber, version, createdAt };
};

const toMaterialItem = (raw: unknown): MaterialItem | null => {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const entryId = readString(record.entryId || record.FEntryID || record.fentryid);
  const itemId = readString(record.itemId || record.FItemID || record.fitemid);
  const materialCode = readString(
    record.materialCode ||
      record.code ||
      record.material_code ||
      record.FNumber ||
      record.fnumber ||
      record.FItemNumber ||
      record.fitemnumber ||
      record.FMaterialNumber ||
      record.fmaterialnumber
  );
  const materialName = readString(
    record.materialName ||
      record.name ||
      record.material_name ||
      record.FName ||
      record.fname ||
      record.FItemName ||
      record.fitemname ||
      record.FMaterialName ||
      record.fmaterialname
  );
  const quantity = readNumber(
    record.quantity || record.qty || record.FAuxQty || record.fauxqty || record.FQty || record.fqty
  );
  const unit = readString(record.unit || record.FUnit || record.funit) || "件";
  const unitPrice = readNumber(
      record.unitPrice || record.price || record.FStandardCost || record.fstandardcost || record.FCost || record.fcost
  );
  const sortValue = readString(record.sort || record.FSort || record.fsort);
  const sortLevel = sortValue ? sortValue.match(/^\.*/)?.[0]?.length ?? 0 : 0;
  const level = readNumber(
    record.level ||
      record.bomLevel ||
      record.FLevel ||
      record.flevel ||
      record.FItemLevel ||
      record.fitemlevel
  );
  const parentId = readString(
    record.parentId ||
      record.parentID ||
      record.FParentID ||
      record.fparentid ||
      record.FParentItemID ||
      record.fparentitemid ||
      record.FParentEntryID ||
      record.fparententryid
  );
  const path = readString(record.path || record.FPath || record.fpath);
  if (!materialCode && !materialName) return null;
  const material: MaterialItem = { entryId, itemId, materialCode, materialName, quantity, unit, unitPrice };
  if (Number.isFinite(level) && level > 0) material.level = level;
  else if (sortValue) material.level = sortLevel;
  if (parentId) material.parentId = parentId;
  if (path) material.path = path;
  return material;
};

const formatDateOnly = (value: unknown) => {
  if (value instanceof Date) return value.toISOString().split("T")[0];
  if (typeof value === "string" && value.trim()) return value.split("T")[0];
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString().split("T")[0];
  return new Date().toISOString().split("T")[0];
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

  try {
    const normalized = normalizeSqlServerConnectionString(connectionString);
    const pool = new sql.ConnectionPool(normalized);
    pool.on("error", (err) => {
      console.error("[DB] SQL Pool Error:", err);
      globalForSqlServer.__xmSqlServerPool = undefined;
      globalForSqlServer.__xmSqlServerKey = undefined;
    });

    globalForSqlServer.__xmSqlServerPool = pool;
    globalForSqlServer.__xmSqlServerKey = connectionString;
    await pool.connect();
    return pool;
  } catch (error) {
    console.error("[DB] SQL Connect Error:", error);
    throw error;
  }
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

const checkSqlTableExists = async (pool: sql.ConnectionPool, tableName: string) => {
  if (!tableName) return false;
  const result = await pool
    .request()
    .input("table", sql.NVarChar, tableName)
    .query("SELECT 1 AS ok WHERE OBJECT_ID(@table, 'U') IS NOT NULL");
  return Array.isArray(result.recordset) && result.recordset.length > 0;
};

export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ message: "未登录" }, { status: 401 });
  }
  
  const url = new URL(request.url);
  const query = url.searchParams.get("query") || url.searchParams.get("q") || "";
  const id = url.searchParams.get("id") || "";
  const wantsMaterials = url.searchParams.get("materials") === "1" || url.searchParams.get("materials") === "true";
  const wantsCustDiff = url.searchParams.get("custDiff") === "1" || url.searchParams.get("custDiff") === "true";
  const isProject = url.searchParams.get("project") === "1" || url.searchParams.get("project") === "true";
  const isCustomer = !isProject && (url.searchParams.get("customer") === "1" || url.searchParams.get("customer") === "true");
  const bomPrefixCond = isProject || isCustomer ? "NOT LIKE 'BOM%'" : "LIKE 'BOM%'";

  const settings = getAppSettings();
  const envConnectionString =
    process.env.XM_SQLSERVER_CONNECTION_STRING ||
    process.env.SQL_SERVER_CONNECTION_STRING ||
    process.env.SQLSERVER_CONNECTION_STRING ||
    "";
  const envTable =
    process.env.XM_SQLSERVER_FORMS_TABLE ||
    process.env.SQL_SERVER_FORMS_TABLE ||
    process.env.SQLSERVER_FORMS_TABLE ||
    "";
  const envCustomerTable =
    process.env.XM_SQLSERVER_CUSTOMER_FORMS_TABLE ||
    process.env.SQL_SERVER_CUSTOMER_FORMS_TABLE ||
    process.env.SQLSERVER_CUSTOMER_FORMS_TABLE ||
    "ICCustBom";
  const envMaterialsQuery =
    process.env.XM_SQLSERVER_FORMS_MATERIALS_SQL ||
    process.env.SQL_SERVER_FORMS_MATERIALS_SQL ||
    process.env.SQLSERVER_FORMS_MATERIALS_SQL ||
    "";
  const settingsSqlServer = settings?.forms?.sqlServer;
  const source = settings?.forms?.source || "local";
  const hasSqlServerConfig = Boolean(settingsSqlServer?.connectionString?.trim() && settingsSqlServer.table?.trim());
  const hasEnvSqlServerConfig = Boolean(envConnectionString.trim() && envTable.trim());
  const effectiveSource =
    source === "local" && (hasSqlServerConfig || hasEnvSqlServerConfig) ? "sqlserver" : source;
  const limit = settingsSqlServer?.limit || 50;

  try {
    if (effectiveSource === "local") {
      if (wantsCustDiff) {
        if (!id) {
          return NextResponse.json({ message: "缺少BOM编码" }, { status: 400 });
        }
        const baseSeed = id.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
        const items: MaterialItem[] = [
          {
            entryId: "1",
            itemId: "1",
            materialCode: `MAT-${(baseSeed % 90) + 10}`,
            materialName: "结构件",
            quantity: (baseSeed % 4) + 1,
            unit: "件",
            unitPrice: 0,
          },
          {
            entryId: "2",
            itemId: "2",
            materialCode: `MAT-${(baseSeed % 80) + 20}`,
            materialName: "紧固件",
            quantity: (baseSeed % 6) + 4,
            unit: "件",
            unitPrice: 0,
          },
        ];
        return NextResponse.json({ items });
      }
      if (wantsMaterials) {
        if (!id) {
          return NextResponse.json({ message: "缺少表单ID" }, { status: 400 });
        }
        const baseSeed = id.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
        const materials: MaterialItem[] = [
          {
            entryId: "1",
            itemId: "1",
            materialCode: `MAT-${(baseSeed % 90) + 10}`,
            materialName: "结构件",
            quantity: (baseSeed % 4) + 1,
            unit: "件",
            unitPrice: 18 + (baseSeed % 12),
          },
          {
            entryId: "2",
            itemId: "2",
            materialCode: `MAT-${(baseSeed % 80) + 20}`,
            materialName: "紧固件",
            quantity: (baseSeed % 6) + 4,
            unit: "件",
            unitPrice: 2 + (baseSeed % 3),
          },
          {
            entryId: "3",
            itemId: "3",
            materialCode: `MAT-${(baseSeed % 70) + 30}`,
            materialName: "电机组件",
            quantity: 1,
            unit: "件",
            unitPrice: 120 + (baseSeed % 30),
          },
          {
            entryId: "4",
            itemId: "4",
            materialCode: `MAT-${(baseSeed % 60) + 40}`,
            materialName: "控制模块",
            quantity: 1,
            unit: "件",
            unitPrice: 85 + (baseSeed % 18),
          },
        ];
        return NextResponse.json({ materials });
      }
      if (id) {
        const match = getFormTemplateById(id);
        if (!match || match.companyId !== user.companyId) {
          return NextResponse.json({ message: "表单不存在" }, { status: 404 });
        }
        const matchBomNumber = match.id || match.code || "";
        const isBom = matchBomNumber.startsWith("BOM");
        if (isProject ? isBom : isCustomer ? isBom : !isBom) {
          return NextResponse.json({ message: "表单不存在" }, { status: 404 });
        }
        const payload = { ...match, createdAt: formatDateOnly(match.createdAt) };
        if (isProject) {
          return NextResponse.json({
            ...payload,
            project: {
              name: match.name || "",
              initiator: "",
              problem: "",
              goal: "",
              actions: "",
              resources: "",
              cycle: "",
              benefit: "",
              approval: "",
            },
          });
        }
        return NextResponse.json(payload);
      }
      const items = getFormTemplates(user, query)
        .filter((item) => {
          const bomNumber = item.id || item.code || "";
          const isBom = bomNumber.startsWith("BOM");
          if (isProject || isCustomer) return !isBom;
          return isBom;
        })
        .slice(0, limit)
        .map((item) => ({ ...item, createdAt: formatDateOnly(item.createdAt) }));
      return NextResponse.json(items);
    }

    if (effectiveSource === "upstream") {
      const upstream = settings.forms.upstream;
      if (!upstream?.url) {
        return NextResponse.json({ message: "表单数据源未配置" }, { status: 500 });
      }
      const upstreamUrl = new URL(upstream.url);
      if (id) {
        upstreamUrl.searchParams.set("id", id);
      } else {
        upstreamUrl.searchParams.set("query", query);
      }
      if (wantsMaterials) {
        upstreamUrl.searchParams.set("materials", "1");
      }
      if (isProject) {
        upstreamUrl.searchParams.set("project", "1");
      }
      if (isCustomer) {
        upstreamUrl.searchParams.set("customer", "1");
      }
      const headers: Record<string, string> = {};
      if (upstream.apiKey) headers.Authorization = `Bearer ${upstream.apiKey}`;
      const upstreamResponse = await fetch(upstreamUrl.toString(), { headers, cache: "no-store" });
      if (!upstreamResponse.ok) {
        return NextResponse.json({ message: "加载表单失败" }, { status: upstreamResponse.status });
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
    if (!sqlServer?.connectionString?.trim() || !sqlServer.table?.trim()) {
      return NextResponse.json({ message: "表单数据源未配置，请在系统设置中完善连接信息" }, { status: 500 });
    }
    const connectionString = sqlServer.connectionString.trim();
    const table = sqlServer.table.trim();
    const customerTable = envCustomerTable.trim() || "ICCustBom";
    const sqlLimit = sqlServer.limit || 50;
    const materialTable = isCustomer ? "ICCustBomChild" : "ICBomChild";
    const tableFlags = await withSqlServerPool(connectionString, async (pool) => {
      const hasBaseTable = await checkSqlTableExists(pool, table);
      const hasCustomerTable = await checkSqlTableExists(pool, customerTable);
      const hasBaseChild = await checkSqlTableExists(pool, "ICBomChild");
      const hasCustomerChild = await checkSqlTableExists(pool, "ICCustBomChild");
      return { hasBaseTable, hasCustomerTable, hasBaseChild, hasCustomerChild };
    });
    if (!tableFlags.hasBaseTable && !tableFlags.hasCustomerTable) {
      return NextResponse.json({ message: "BOM表不存在，请检查表名配置" }, { status: 500 });
    }
    const activeTable = isCustomer && tableFlags.hasCustomerTable ? customerTable : table;
    const listTable = isProject ? table : activeTable;

    if (wantsCustDiff) {
      if (!id) {
        return NextResponse.json({ message: "缺少BOM编码" }, { status: 400 });
      }
      const rows = await withSqlServerPool(connectionString, async (pool) => {
        const request = pool.request().input("bomNumber", sql.NVarChar, id);
        const result = await request.query("EXEC h_p_CustBOM @FNumber = @bomNumber");
        return result.recordset || [];
      });
      const items = rows
        .map((item) => toMaterialItem(item))
        .filter((item): item is MaterialItem => Boolean(item));
      const uniqueCodes = Array.from(
        new Set(items.map((item) => item.materialCode.trim()).filter(Boolean))
      );
      if (uniqueCodes.length === 0) {
        return NextResponse.json({ items });
      }
      const priceMap = await withSqlServerPool(connectionString, async (pool) => {
        const hasPoOrder = await checkSqlTableExists(pool, "POOrder");
        if (!hasPoOrder) return new Map<string, number>();
        const request = pool.request();
        uniqueCodes.forEach((code, index) => {
          request.input(`code${index}`, sql.NVarChar(256), code);
        });
        const placeholders = uniqueCodes.map((_, index) => `@code${index}`).join(", ");
        const result = await request.query(
          `SELECT CAST([物料代码] AS NVARCHAR(256)) AS materialCode,
                  MAX(CAST([最新采购单价] AS FLOAT)) AS unitPrice
           FROM POOrder
           WHERE [物料代码] IN (${placeholders})
           GROUP BY [物料代码]`
        );
        const map = new Map<string, number>();
        (result.recordset || []).forEach((row) => {
          const code = readString((row as Record<string, unknown>).materialCode).trim();
          const price = readNumber((row as Record<string, unknown>).unitPrice);
          if (!code) return;
          map.set(code, price);
        });
        return map;
      });
      const nextItems = items.map((item) => {
        const code = item.materialCode.trim();
        if (!code) return item;
        const price = priceMap.get(code);
        return typeof price === "number" ? { ...item, unitPrice: price } : item;
      });
      return NextResponse.json({ items: nextItems });
    }

    if (wantsMaterials) {
      if (!id) {
        return NextResponse.json({ message: "缺少表单ID" }, { status: 400 });
      }
      const materialRows = await withSqlServerPool(connectionString, async (pool) => {
        const request = pool.request().input("id", sql.NVarChar, id).input("limit", sql.Int, sqlLimit);
        const customSql = envMaterialsQuery.trim();
        if (customSql) {
          const result = await request.query(customSql);
          return result.recordset || [];
        }
        if (isCustomer) {
          const bomSources = [
            tableFlags.hasBaseTable
              ? `SELECT FInterID, FBOMNumber FROM ${table} WHERE CAST(FBOMNumber AS NVARCHAR(128)) = @id`
              : null,
            tableFlags.hasCustomerTable
              ? `SELECT FInterID, FBOMNumber FROM ${customerTable} WHERE CAST(FBOMNumber AS NVARCHAR(128)) = @id`
              : null,
          ].filter(Boolean);
          const childSources = [
            tableFlags.hasBaseChild
              ? "SELECT FInterID, FEntryID, FItemID, FNumber, FName, FAuxQty FROM ICBomChild"
              : null,
            tableFlags.hasCustomerChild
              ? "SELECT FInterID, FEntryID, FItemID, FNumber, FName, FAuxQty FROM ICCustBomChild"
              : null,
          ].filter(Boolean);
          if (bomSources.length === 0 || childSources.length === 0) {
            return [];
          }
          const queryText = `WITH bom AS (${bomSources.join(" UNION ALL ")}),
            child AS (${childSources.join(" UNION ALL ")})
            SELECT TOP (@limit)
              CAST(child.FEntryID AS NVARCHAR(128)) AS entryId,
              CAST(child.FItemID AS NVARCHAR(128)) AS itemId,
              CAST(child.FNumber AS NVARCHAR(256)) AS materialCode,
              CAST(child.FName AS NVARCHAR(512)) AS materialName,
              child.FAuxQty AS quantity,
              0 AS unitPrice
            FROM child
            INNER JOIN bom
              ON child.FInterID = bom.FInterID`;
          const result = await request.query(queryText);
          return result.recordset || [];
        }
        const queryText = `SELECT TOP (@limit)
              CAST(child.FEntryID AS NVARCHAR(128)) AS entryId,
              CAST(child.FItemID AS NVARCHAR(128)) AS itemId,
              CAST(child.FNumber AS NVARCHAR(256)) AS materialCode,
              CAST(child.FName AS NVARCHAR(512)) AS materialName,
              child.FAuxQty AS quantity,
              0 AS unitPrice
            FROM ${materialTable} AS child
            INNER JOIN ${table} AS bom
              ON child.FInterID = bom.FInterID
            WHERE CAST(bom.FBOMNumber AS NVARCHAR(128)) = @id`;
        const result = await request.query(queryText);
        return result.recordset || [];
      });
      const materials = materialRows
        .map((item) => toMaterialItem(item))
        .filter((item): item is MaterialItem => Boolean(item));
      return NextResponse.json({ materials });
    }

    if (id) {
      const row = await withSqlServerPool(connectionString, async (pool) => {
        const request = pool.request().input("id", sql.NVarChar, id);
        const baseSelect = `CAST(FBOMNumber AS NVARCHAR(128)) AS id,
              CAST(FNumber AS NVARCHAR(256)) AS code,
              CAST(FName AS NVARCHAR(512)) AS name,
              CAST(FBOMNumber AS NVARCHAR(128)) AS bomNumber,
              FEntertime AS createdAt,
              FInterID AS interId,
              FAuxQty AS auxQty,
              FStandardCost AS standardCost,
              FBOMNumber AS FBOMNumber,
              FNumber AS FNumber,
              FName AS FName,
              FEntertime AS FEntertime,
              FAuxQty AS FAuxQty,
              FStandardCost AS FStandardCost`;
        const baseWhere = `CAST(FBOMNumber AS NVARCHAR(128)) = @id OR CAST(FNumber AS NVARCHAR(256)) = @id OR CAST(FName AS NVARCHAR(512)) = @id OR CAST(FInterID AS NVARCHAR(128)) = @id`;
        const queryText = isCustomer
          ? `SELECT TOP (1) ${baseSelect}
              FROM ${customerTable}
              WHERE ${baseWhere}
            UNION ALL
            SELECT TOP (1) ${baseSelect}
              FROM ${table}
              WHERE ${baseWhere}`
          : `SELECT TOP (1) ${baseSelect}
              FROM ${table}
              WHERE ${baseWhere}`;
        const result = await request.query(queryText);
        const records = Array.isArray(result.recordset) ? result.recordset : [];
        return records[0] || null;
      });
      if (!row) {
        return NextResponse.json({ message: "表单不存在" }, { status: 404 });
      }
      const record = row as Record<string, unknown>;
      const createdAt = formatDateOnly(record.createdAt);
      if (isProject) {
        return NextResponse.json({
          ...record,
          createdAt,
          project: toProjectFormFields(record),
        });
      }
      return NextResponse.json({ ...record, createdAt });
    }

    const q = query.trim();
    const records = await withSqlServerPool(connectionString, async (pool) => {
      const result = await pool
        .request()
        .input("q", sql.NVarChar, q)
        .input("limit", sql.Int, sqlLimit)
        .query(
          `SELECT TOP (@limit)
            CAST(FBOMNumber AS NVARCHAR(128)) AS id,
            CAST(FNumber AS NVARCHAR(256)) AS code,
            CAST(FName AS NVARCHAR(512)) AS name,
            CAST(FBOMNumber AS NVARCHAR(128)) AS bomNumber,
            FEntertime AS createdAt
          FROM ${listTable}
          WHERE CAST(FBOMNumber AS NVARCHAR(128)) ${bomPrefixCond} AND
            (@q = '' OR
            CAST(FBOMNumber AS NVARCHAR(128)) LIKE '%' + @q + '%' OR
            CAST(FNumber AS NVARCHAR(256)) LIKE '%' + @q + '%' OR
            CAST(FName AS NVARCHAR(512)) LIKE '%' + @q + '%')
          ORDER BY FEntertime DESC`
        );
      return result.recordset || [];
    });

    const normalized: TemplateSummary[] = records
      .map((item) => toTemplateSummary(item))
      .filter((item): item is TemplateSummary => Boolean(item))
      .map((item) => ({ ...item, createdAt: formatDateOnly(item.createdAt) }));

    return NextResponse.json(normalized);
  } catch (error) {
    console.error("[DB] Query Execution Error:", error);
    const message = formatSqlErrorMessage(error);
    return NextResponse.json({ message }, { status: 500 });
  }
}
