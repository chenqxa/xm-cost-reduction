import sql from "mssql";
import {
  PricingColumn,
  PricingDiff,
  PricingItem,
  PricingLog,
  PricingSheet,
  PricingSheetSummary,
  PricingVersion,
} from "@/types";

const normalizeSqlServerConnectionString = (connectionString: string) => {
  const trimmed = connectionString.trim().replace(/;+$/, "");
  if (!trimmed) return "";
  const parts = trimmed.split(";").map((p) => p.trim()).filter(Boolean);
  const hasEncrypt = parts.some((p) => p.toLowerCase().startsWith("encrypt="));
  const hasTrust = parts.some((p) => p.toLowerCase().startsWith("trustservercertificate="));
  const next = [...parts];
  if (!hasEncrypt) next.push("Encrypt=false");
  if (!hasTrust) next.push("TrustServerCertificate=true");
  return `${next.join(";")};`;
};

const globalForPricingSql = globalThis as unknown as {
  __xmPricingSqlPool?: sql.ConnectionPool;
  __xmPricingSqlKey?: string;
};

let tablesEnsured = false;
let pricingProjectIdEnsured = false;
const pricingProjectKeyPrefix = (projectId: string) => `[P:${projectId}]::`;
const encodePricingSheetKey = (key: string, projectId?: string, hasProjectIdColumn?: boolean) =>
  !projectId || hasProjectIdColumn ? key : `${pricingProjectKeyPrefix(projectId)}${key}`;
const decodePricingSheetKey = (key: string) =>
  key.replace(/^\[P:[^\]]+\]::/, "");
const hasPricingProjectIdColumn = async (pool: sql.ConnectionPool) => {
  const result = await pool.request().query(`
    SELECT COL_LENGTH(N'dbo.PricingSheets', N'projectId') AS colLen
  `);
  return Number(result.recordset?.[0]?.colLen) > 0;
};

const getPricingSqlConfig = () => {
  const connectionString =
    process.env.XM_SQLSERVER_CONNECTION_STRING ||
    process.env.SQLSERVER_CONNECTION_STRING ||
    process.env.SQL_SERVER_CONNECTION_STRING ||
    "";
  return connectionString.trim() || null;
};

export const hasPricingSqlConfig = () => Boolean(getPricingSqlConfig());

const getPool = async (connStr: string): Promise<sql.ConnectionPool> => {
  const existing = globalForPricingSql.__xmPricingSqlPool;
  if (existing && globalForPricingSql.__xmPricingSqlKey === connStr) {
    try {
      await existing.request().query("SELECT 1");
      return existing;
    } catch {
      globalForPricingSql.__xmPricingSqlPool = undefined;
      globalForPricingSql.__xmPricingSqlKey = undefined;
      try { await existing.close(); } catch { /* ignore */ }
    }
  }
  const normalized = normalizeSqlServerConnectionString(connStr);
  const pool = new sql.ConnectionPool(normalized);
  pool.on("error", () => {
    globalForPricingSql.__xmPricingSqlPool = undefined;
    globalForPricingSql.__xmPricingSqlKey = undefined;
  });
  globalForPricingSql.__xmPricingSqlPool = pool;
  globalForPricingSql.__xmPricingSqlKey = connStr;
  await pool.connect();
  return pool;
};

const resetPool = async () => {
  const existing = globalForPricingSql.__xmPricingSqlPool;
  globalForPricingSql.__xmPricingSqlPool = undefined;
  globalForPricingSql.__xmPricingSqlKey = undefined;
  if (existing) { try { await existing.close(); } catch { /* ignore */ } }
};

const withPool = async <T,>(handler: (pool: sql.ConnectionPool) => Promise<T>): Promise<T> => {
  const connStr = getPricingSqlConfig();
  if (!connStr) throw new Error("No SQL Server connection string configured for pricing");
  try {
    const pool = await getPool(connStr);
    return await handler(pool);
  } catch {
    await resetPool();
    const pool = await getPool(connStr);
    return await handler(pool);
  }
};

const ensureTables = async (pool: sql.ConnectionPool) => {
  if (!tablesEnsured) {
    await pool.request().query(`
      IF OBJECT_ID(N'dbo.PricingSheets', 'U') IS NULL
      BEGIN
        CREATE TABLE dbo.PricingSheets (
          id NVARCHAR(20) NOT NULL PRIMARY KEY,
          sheetKey NVARCHAR(200) NOT NULL,
          projectId NVARCHAR(64) NULL,
          name NVARCHAR(400) NOT NULL DEFAULT '',
          baseVersionId NVARCHAR(20) NOT NULL DEFAULT '',
          latestVersionId NVARCHAR(20) NOT NULL DEFAULT '',
          createdAt DATETIME2 NOT NULL DEFAULT GETDATE(),
          updatedAt DATETIME2 NOT NULL DEFAULT GETDATE(),
          createdBy NVARCHAR(20) NULL,
          departmentId NVARCHAR(50) NULL
        );
      END
    `);
  }
  await pool.request().query(`
    IF OBJECT_ID(N'dbo.PricingVersions', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.PricingVersions (
        id NVARCHAR(20) NOT NULL PRIMARY KEY,
        sheetId NVARCHAR(20) NOT NULL,
        versionNo INT NOT NULL DEFAULT 1,
        fileHash NVARCHAR(64) NOT NULL DEFAULT '',
        fileName NVARCHAR(500) NOT NULL DEFAULT '',
        uploadedBy NVARCHAR(20) NOT NULL DEFAULT '',
        uploadedByName NVARCHAR(100) NULL,
        uploadedAt DATETIME2 NOT NULL DEFAULT GETDATE(),
        mainColumnsJson NVARCHAR(MAX) NULL,
        mainFieldsJson NVARCHAR(MAX) NULL,
        columnsJson NVARCHAR(MAX) NULL
      );
      CREATE INDEX IX_PricingVersions_SheetId ON dbo.PricingVersions(sheetId);
    END
  `);
  await pool.request().query(`
    IF OBJECT_ID(N'dbo.PricingItems', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.PricingItems (
        id INT IDENTITY(1,1) PRIMARY KEY,
        versionId NVARCHAR(20) NOT NULL,
        materialCode NVARCHAR(200) NOT NULL DEFAULT '',
        materialName NVARCHAR(400) NOT NULL DEFAULT '',
        price FLOAT NULL,
        amount FLOAT NULL,
        fieldsJson NVARCHAR(MAX) NULL,
        seq INT NOT NULL DEFAULT 0
      );
      CREATE INDEX IX_PricingItems_VersionId ON dbo.PricingItems(versionId);
    END
  `);
  await pool.request().query(`
    IF OBJECT_ID(N'dbo.PricingLogs', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.PricingLogs (
        id INT IDENTITY(1,1) PRIMARY KEY,
        sheetId NVARCHAR(20) NULL,
        sheetKey NVARCHAR(200) NULL,
        action NVARCHAR(50) NOT NULL DEFAULT '',
        detail NVARCHAR(MAX) NULL,
        userId NVARCHAR(20) NOT NULL DEFAULT '',
        userName NVARCHAR(100) NOT NULL DEFAULT '',
        createdAt DATETIME2 NOT NULL DEFAULT GETDATE()
      );
      CREATE INDEX IX_PricingLogs_SheetId ON dbo.PricingLogs(sheetId);
    END
  `);
  if (!tablesEnsured) tablesEnsured = true;
  if (pricingProjectIdEnsured) return;
  try {
    await pool.request().query(`
      IF COL_LENGTH(N'dbo.PricingSheets', N'projectId') IS NULL
      BEGIN
        ALTER TABLE dbo.PricingSheets ADD projectId NVARCHAR(64) NULL;
      END
    `);
    await pool.request().query(`
      IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_PricingSheets_Key' AND object_id = OBJECT_ID(N'dbo.PricingSheets'))
      BEGIN
        DROP INDEX UX_PricingSheets_Key ON dbo.PricingSheets;
      END
    `);
    await pool.request().query(`
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_PricingSheets_KeyProject_NotNull' AND object_id = OBJECT_ID(N'dbo.PricingSheets'))
      BEGIN
        CREATE UNIQUE INDEX UX_PricingSheets_KeyProject_NotNull ON dbo.PricingSheets(sheetKey, projectId) WHERE projectId IS NOT NULL;
      END
    `);
    await pool.request().query(`
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_PricingSheets_KeyProject_Null' AND object_id = OBJECT_ID(N'dbo.PricingSheets'))
      BEGIN
        CREATE UNIQUE INDEX UX_PricingSheets_KeyProject_Null ON dbo.PricingSheets(sheetKey) WHERE projectId IS NULL;
      END
    `);
  } catch {
    pricingProjectIdEnsured = false;
    return;
  }
  pricingProjectIdEnsured = await hasPricingProjectIdColumn(pool);
};

const createId = (prefix: string) => `${prefix}${Math.random().toString(36).slice(2, 9)}`;

const safeParseJson = <T,>(value: unknown, fallback: T): T => {
  if (typeof value !== "string" || !value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
};

const readPricingNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const text = value.trim().replace(/,/g, "");
    if (!text) return Number.NaN;
    const parsed = Number(text);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Number.NaN;
};

const normalizePricingHeader = (value: string) =>
  value.toLowerCase().replace(/\s+/g, "").replace(/[_\-()（）]/g, "");

const findPricingColumnKey = (columns: PricingColumn[] | undefined, labels: string[]) => {
  if (!Array.isArray(columns) || columns.length === 0) return "";
  const normalizedLabels = labels.map((l) => normalizePricingHeader(l));
  let best: { key: string; score: number } = { key: "", score: -1 };
  columns.forEach((col, idx) => {
    const norm = normalizePricingHeader(String(col.label || ""));
    if (!norm) return;
    const score = normalizedLabels.findIndex((l) => norm.includes(l));
    if (score >= 0) {
      const w = (normalizedLabels.length - score) * 1000 - idx;
      if (w > best.score) best = { key: col.key, score: w };
    }
  });
  return best.key;
};

const toPricingDiffs = (baseItems: PricingItem[], latestItems: PricingItem[]): PricingDiff[] => {
  const readItemAmount = (item?: PricingItem) => {
    if (!item) return null;
    const amount = typeof item.amount === "number" && Number.isFinite(item.amount)
      ? item.amount
      : (typeof item.price === "number" && Number.isFinite(item.price) ? item.price : null);
    return amount;
  };
  const groupByCode = (items: PricingItem[]) => {
    const map = new Map<string, PricingItem[]>();
    const order: string[] = [];
    items.forEach((item) => {
      const code = item.materialCode || "";
      if (!code) return;
      if (!map.has(code)) { map.set(code, []); order.push(code); }
      map.get(code)?.push(item);
    });
    return { map, order };
  };
  const baseGrouped = groupByCode(baseItems);
  const latestGrouped = groupByCode(latestItems);
  const codes: string[] = [];
  const seen = new Set<string>();
  for (const c of latestGrouped.order) { if (!seen.has(c)) { seen.add(c); codes.push(c); } }
  for (const c of baseGrouped.order) { if (!seen.has(c)) { seen.add(c); codes.push(c); } }
  const diffs: PricingDiff[] = [];
  codes.forEach((code) => {
    const baseList = baseGrouped.map.get(code) || [];
    const latestList = latestGrouped.map.get(code) || [];
    const max = Math.max(baseList.length, latestList.length);
    for (let i = 0; i < max; i++) {
      const base = baseList[i];
      const latest = latestList[i];
      const baseAmount = readItemAmount(base);
      const latestAmount = readItemAmount(latest);
      const delta = (latestAmount ?? 0) - (baseAmount ?? 0);
      let status: PricingDiff["status"] = "unchanged";
      if (!base) status = "added";
      else if (!latest) status = "removed";
      else if (Math.abs(delta) > 0.0001) status = "changed";
      diffs.push({
        materialCode: code,
        materialName: latest?.materialName || base?.materialName || "",
        baseAmount, latestAmount, deltaAmount: delta,
        basePrice: baseAmount, latestPrice: latestAmount, delta,
        status,
        fields: latest?.fields || base?.fields || {},
        baseFields: base?.fields || {},
      });
    }
  });
  return diffs;
};

// --- Public API ---

export async function getPricingSheetListFromSql(
  departmentId?: string,
  query?: string,
  projectId?: string
): Promise<PricingSheetSummary[]> {
  return withPool(async (pool) => {
    await ensureTables(pool);
    const hasProjectIdColumn = await hasPricingProjectIdColumn(pool);
    let q = `
      SELECT s.id, s.sheetKey, s.name, s.createdAt, s.updatedAt, s.createdBy, s.departmentId,
        (SELECT COUNT(*) FROM dbo.PricingVersions v WHERE v.sheetId = s.id) AS versionCount,
        (SELECT MAX(v.versionNo) FROM dbo.PricingVersions v WHERE v.sheetId = s.id) AS latestVersionNo
      FROM dbo.PricingSheets s
      WHERE 1=1
    `;
    const request = pool.request();
    if (departmentId) {
      q += ` AND (s.departmentId = @departmentId OR s.departmentId IS NULL)`;
      request.input("departmentId", sql.NVarChar(50), departmentId);
    }
    if (query) {
      q += ` AND (s.sheetKey LIKE @q OR s.name LIKE @q)`;
      request.input("q", sql.NVarChar(400), `%${query}%`);
    }
    if (projectId) {
      if (hasProjectIdColumn) {
        q += ` AND s.projectId = @projectId`;
        request.input("projectId", sql.NVarChar(64), projectId);
      } else {
        q += ` AND s.sheetKey LIKE @projectScopedKey`;
        request.input("projectScopedKey", sql.NVarChar(260), `${pricingProjectKeyPrefix(projectId)}%`);
      }
    }
    q += ` ORDER BY s.updatedAt DESC`;
    const result = await request.query(q);
    return (result.recordset || []).map((r: Record<string, unknown>) => ({
      id: String(r.id || ""),
      key: decodePricingSheetKey(String(r.sheetKey || "")),
      name: String(r.name || ""),
      projectId: r.projectId ? String(r.projectId) : undefined,
      versionCount: Number(r.versionCount) || 0,
      latestVersionNo: Number(r.latestVersionNo) || 0,
      updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : String(r.updatedAt || ""),
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt || ""),
      createdBy: r.createdBy ? String(r.createdBy) : undefined,
      departmentId: r.departmentId ? String(r.departmentId) : undefined,
    }));
  });
}

export async function getPricingSheetByIdFromSql(sheetId: string): Promise<PricingSheet | null> {
  return withPool(async (pool) => {
    await ensureTables(pool);
    const sheetResult = await pool.request()
      .input("id", sql.NVarChar(20), sheetId)
      .query(`SELECT * FROM dbo.PricingSheets WHERE id = @id`);
    const sheetRow = sheetResult.recordset?.[0];
    if (!sheetRow) return null;

    const versionsResult = await pool.request()
      .input("sheetId", sql.NVarChar(20), sheetId)
      .query(`SELECT * FROM dbo.PricingVersions WHERE sheetId = @sheetId ORDER BY versionNo ASC`);
    const versionRows = versionsResult.recordset || [];

    // 一次性批量拉取该 sheet 所有版本的 items，避免 N+1 查询
    const allItemsResult = versionRows.length > 0
      ? await pool.request()
          .input("sheetId", sql.NVarChar(20), sheetId)
          .query(`
            SELECT pi.*
            FROM dbo.PricingItems pi
            INNER JOIN dbo.PricingVersions pv ON pi.versionId = pv.id
            WHERE pv.sheetId = @sheetId
            ORDER BY pi.versionId, pi.seq ASC
          `)
      : { recordset: [] };

    // 按 versionId 分组
    const itemsByVersion = new Map<string, PricingItem[]>();
    for (const ir of (allItemsResult.recordset || []) as Record<string, unknown>[]) {
      const vid = String(ir.versionId || "");
      if (!itemsByVersion.has(vid)) itemsByVersion.set(vid, []);
      itemsByVersion.get(vid)!.push({
        materialCode: String(ir.materialCode || ""),
        materialName: String(ir.materialName || ""),
        price: typeof ir.price === "number" ? ir.price : undefined,
        amount: typeof ir.amount === "number" ? ir.amount : 0,
        fields: safeParseJson<Record<string, string>>(ir.fieldsJson, {}),
      });
    }

    const versions: PricingVersion[] = versionRows.map((vr) => {
      const vid = String(vr.id);
      return {
        id: vid,
        sheetId,
        versionNo: Number(vr.versionNo) || 1,
        fileHash: String(vr.fileHash || ""),
        fileName: String(vr.fileName || ""),
        uploadedBy: String(vr.uploadedBy || ""),
        uploadedByName: vr.uploadedByName ? String(vr.uploadedByName) : undefined,
        uploadedAt: vr.uploadedAt instanceof Date ? vr.uploadedAt.toISOString() : String(vr.uploadedAt || ""),
        mainColumns: safeParseJson<PricingColumn[]>(vr.mainColumnsJson, []),
        mainFields: safeParseJson<Record<string, string>>(vr.mainFieldsJson, {}),
        columns: safeParseJson<PricingColumn[]>(vr.columnsJson, []),
        items: itemsByVersion.get(vid) || [],
      };
    });

    const baseVersion = versions.find((v) => v.id === String(sheetRow.baseVersionId)) || versions[0];
    const latestVersion = versions.find((v) => v.id === String(sheetRow.latestVersionId)) || versions.at(-1);
    const diffs = baseVersion && latestVersion
      ? toPricingDiffs(baseVersion.items || [], latestVersion.items || [])
      : [];

    return {
      id: String(sheetRow.id),
      key: decodePricingSheetKey(String(sheetRow.sheetKey || "")),
      name: String(sheetRow.name || ""),
      projectId: sheetRow.projectId ? String(sheetRow.projectId) : undefined,
      baseVersionId: String(sheetRow.baseVersionId || ""),
      latestVersionId: String(sheetRow.latestVersionId || ""),
      versions,
      diffs,
      mainColumns: latestVersion?.mainColumns || [],
      mainFields: latestVersion?.mainFields || {},
      diffColumns: latestVersion?.columns || [],
      createdAt: sheetRow.createdAt instanceof Date ? sheetRow.createdAt.toISOString() : String(sheetRow.createdAt || ""),
      updatedAt: sheetRow.updatedAt instanceof Date ? sheetRow.updatedAt.toISOString() : String(sheetRow.updatedAt || ""),
      createdBy: sheetRow.createdBy ? String(sheetRow.createdBy) : undefined,
      departmentId: sheetRow.departmentId ? String(sheetRow.departmentId) : undefined,
    };
  });
}

export async function addPricingSheetVersionToSql(params: {
  key: string;
  name?: string;
  projectId?: string;
  fileHash: string;
  fileName: string;
  uploadedBy: string;
  uploadedByName?: string;
  departmentId?: string;
  mainColumns?: PricingColumn[];
  mainFields?: Record<string, string>;
  columns?: PricingColumn[];
  items: PricingItem[];
}): Promise<{ status: "created" | "updated" | "duplicate" | "invalid"; sheet?: PricingSheet }> {
  const key = params.key.trim();
  if (!key) return { status: "invalid" };

  return withPool(async (pool) => {
    await ensureTables(pool);
    const hasProjectIdColumn = await hasPricingProjectIdColumn(pool);
    const now = new Date().toISOString();
    const scopedKey = encodePricingSheetKey(key, params.projectId, hasProjectIdColumn);

    // Check if sheet exists
    const existingRequest = pool.request()
      .input("key", sql.NVarChar(200), scopedKey);
    let existingSql = `SELECT * FROM dbo.PricingSheets WHERE sheetKey = @key`;
    if (params.projectId && hasProjectIdColumn) {
      existingSql += ` AND projectId = @projectId`;
      existingRequest.input("projectId", sql.NVarChar(64), params.projectId);
    } else if (hasProjectIdColumn) {
      existingSql += ` AND projectId IS NULL`;
    }
    const existingResult = await existingRequest.query(existingSql);
    const existingSheet = existingResult.recordset?.[0];

    if (!existingSheet) {
      // Create new sheet
      const sheetId = createId("ps");
      const versionId = createId("pv");

      const createSheetRequest = pool.request()
        .input("id", sql.NVarChar(20), sheetId)
        .input("sheetKey", sql.NVarChar(200), scopedKey)
        .input("name", sql.NVarChar(400), params.name?.trim() || key)
        .input("baseVersionId", sql.NVarChar(20), versionId)
        .input("latestVersionId", sql.NVarChar(20), versionId)
        .input("createdAt", sql.DateTime2, now)
        .input("updatedAt", sql.DateTime2, now)
        .input("createdBy", sql.NVarChar(20), params.uploadedBy)
        .input("departmentId", sql.NVarChar(50), params.departmentId || null);

      if (hasProjectIdColumn) {
        createSheetRequest.input("projectId", sql.NVarChar(64), params.projectId || null);
      }

      const insertColumns = hasProjectIdColumn
        ? "id, sheetKey, projectId, name, baseVersionId, latestVersionId, createdAt, updatedAt, createdBy, departmentId"
        : "id, sheetKey, name, baseVersionId, latestVersionId, createdAt, updatedAt, createdBy, departmentId";
      const insertValues = hasProjectIdColumn
        ? "@id, @sheetKey, @projectId, @name, @baseVersionId, @latestVersionId, @createdAt, @updatedAt, @createdBy, @departmentId"
        : "@id, @sheetKey, @name, @baseVersionId, @latestVersionId, @createdAt, @updatedAt, @createdBy, @departmentId";

      await createSheetRequest.query(`INSERT INTO dbo.PricingSheets (${insertColumns})
              VALUES (${insertValues})`);

      await insertVersion(pool, {
        id: versionId, sheetId, versionNo: 1,
        fileHash: params.fileHash, fileName: params.fileName,
        uploadedBy: params.uploadedBy, uploadedByName: params.uploadedByName,
        uploadedAt: now,
        mainColumns: params.mainColumns, mainFields: params.mainFields,
        columns: params.columns, items: params.items,
      });

      const sheet = await getPricingSheetByIdFromSql(sheetId);
      return { status: "created" as const, sheet: sheet || undefined };
    }

    // Check for duplicate hash
    const dupResult = await pool.request()
      .input("sheetId", sql.NVarChar(20), String(existingSheet.id))
      .input("fileHash", sql.NVarChar(64), params.fileHash)
      .query(`SELECT id FROM dbo.PricingVersions WHERE sheetId = @sheetId AND fileHash = @fileHash`);
    if (dupResult.recordset?.length > 0) {
      const sheet = await getPricingSheetByIdFromSql(String(existingSheet.id));
      return { status: "duplicate" as const, sheet: sheet || undefined };
    }

    // Add new version
    const maxResult = await pool.request()
      .input("sheetId", sql.NVarChar(20), String(existingSheet.id))
      .query(`SELECT MAX(versionNo) AS maxVer FROM dbo.PricingVersions WHERE sheetId = @sheetId`);
    const nextVersionNo = (Number(maxResult.recordset?.[0]?.maxVer) || 0) + 1;
    const versionId = createId("pv");

    await insertVersion(pool, {
      id: versionId, sheetId: String(existingSheet.id), versionNo: nextVersionNo,
      fileHash: params.fileHash, fileName: params.fileName,
      uploadedBy: params.uploadedBy, uploadedByName: params.uploadedByName,
      uploadedAt: now,
      mainColumns: params.mainColumns, mainFields: params.mainFields,
      columns: params.columns, items: params.items,
    });

    await pool.request()
      .input("id", sql.NVarChar(20), String(existingSheet.id))
      .input("latestVersionId", sql.NVarChar(20), versionId)
      .input("name", sql.NVarChar(400), params.name?.trim() || String(existingSheet.name))
      .input("updatedAt", sql.DateTime2, now)
      .query(`UPDATE dbo.PricingSheets SET latestVersionId = @latestVersionId, name = @name, updatedAt = @updatedAt WHERE id = @id`);

    const sheet = await getPricingSheetByIdFromSql(String(existingSheet.id));
    return { status: "updated" as const, sheet: sheet || undefined };
  });
}

async function insertVersion(pool: sql.ConnectionPool, v: {
  id: string; sheetId: string; versionNo: number;
  fileHash: string; fileName: string;
  uploadedBy: string; uploadedByName?: string;
  uploadedAt: string;
  mainColumns?: PricingColumn[]; mainFields?: Record<string, string>;
  columns?: PricingColumn[]; items: PricingItem[];
}) {
  await pool.request()
    .input("id", sql.NVarChar(20), v.id)
    .input("sheetId", sql.NVarChar(20), v.sheetId)
    .input("versionNo", sql.Int, v.versionNo)
    .input("fileHash", sql.NVarChar(64), v.fileHash)
    .input("fileName", sql.NVarChar(500), v.fileName)
    .input("uploadedBy", sql.NVarChar(20), v.uploadedBy)
    .input("uploadedByName", sql.NVarChar(100), v.uploadedByName || null)
    .input("uploadedAt", sql.DateTime2, v.uploadedAt)
    .input("mainColumnsJson", sql.NVarChar(sql.MAX), JSON.stringify(v.mainColumns || []))
    .input("mainFieldsJson", sql.NVarChar(sql.MAX), JSON.stringify(v.mainFields || {}))
    .input("columnsJson", sql.NVarChar(sql.MAX), JSON.stringify(v.columns || []))
    .query(`INSERT INTO dbo.PricingVersions (id, sheetId, versionNo, fileHash, fileName, uploadedBy, uploadedByName, uploadedAt, mainColumnsJson, mainFieldsJson, columnsJson)
            VALUES (@id, @sheetId, @versionNo, @fileHash, @fileName, @uploadedBy, @uploadedByName, @uploadedAt, @mainColumnsJson, @mainFieldsJson, @columnsJson)`);

  // Batch insert items
  const table = new sql.Table("dbo.PricingItems");
  table.create = false;
  table.columns.add("versionId", sql.NVarChar(20), { nullable: false });
  table.columns.add("materialCode", sql.NVarChar(200), { nullable: false });
  table.columns.add("materialName", sql.NVarChar(400), { nullable: false });
  table.columns.add("price", sql.Float, { nullable: true });
  table.columns.add("amount", sql.Float, { nullable: true });
  table.columns.add("fieldsJson", sql.NVarChar(sql.MAX), { nullable: true });
  table.columns.add("seq", sql.Int, { nullable: false });

  v.items.forEach((item, idx) => {
    table.rows.add(
      v.id,
      item.materialCode || "",
      item.materialName || "",
      typeof item.price === "number" && Number.isFinite(item.price) ? item.price : null,
      typeof item.amount === "number" && Number.isFinite(item.amount) ? item.amount : null,
      JSON.stringify(item.fields || {}),
      idx
    );
  });

  if (table.rows.length > 0) {
    const bulkRequest = pool.request();
    await bulkRequest.bulk(table);
  }
}

// --- Logs ---

export async function addPricingLogToSql(params: {
  sheetId?: string;
  sheetKey?: string;
  action: string;
  detail?: string;
  userId: string;
  userName: string;
}): Promise<void> {
  return withPool(async (pool) => {
    await ensureTables(pool);
    await pool.request()
      .input("sheetId", sql.NVarChar(20), params.sheetId || null)
      .input("sheetKey", sql.NVarChar(200), params.sheetKey || null)
      .input("action", sql.NVarChar(50), params.action)
      .input("detail", sql.NVarChar(sql.MAX), params.detail || null)
      .input("userId", sql.NVarChar(20), params.userId)
      .input("userName", sql.NVarChar(100), params.userName)
      .query(`INSERT INTO dbo.PricingLogs (sheetId, sheetKey, action, detail, userId, userName, createdAt)
              VALUES (@sheetId, @sheetKey, @action, @detail, @userId, @userName, GETDATE())`);
  });
}

export async function getPricingLogsFromSql(
  sheetId?: string,
  limit = 50
): Promise<PricingLog[]> {
  return withPool(async (pool) => {
    await ensureTables(pool);
    const request = pool.request();
    let q = `SELECT TOP (@limit) * FROM dbo.PricingLogs`;
    request.input("limit", sql.Int, Math.min(limit, 200));
    if (sheetId) {
      q += ` WHERE sheetId = @sheetId`;
      request.input("sheetId", sql.NVarChar(20), sheetId);
    }
    q += ` ORDER BY createdAt DESC`;
    const result = await request.query(q);
    return (result.recordset || []).map((r: Record<string, unknown>) => ({
      id: Number(r.id) || 0,
      sheetId: String(r.sheetId || ""),
      sheetKey: String(r.sheetKey || ""),
      action: String(r.action || ""),
      detail: String(r.detail || ""),
      userId: String(r.userId || ""),
      userName: String(r.userName || ""),
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt || ""),
    }));
  });
}

// --- Search ---

export async function searchPricingSheetsFromSql(
  query: string,
  departmentId?: string
): Promise<PricingSheetSummary[]> {
  return withPool(async (pool) => {
    await ensureTables(pool);
    const request = pool.request();
    request.input("q", sql.NVarChar(400), `%${query}%`);

    let q = `
      SELECT s.id, s.sheetKey, s.name, s.createdAt, s.updatedAt, s.createdBy, s.departmentId,
        (SELECT COUNT(*) FROM dbo.PricingVersions v WHERE v.sheetId = s.id) AS versionCount,
        (SELECT MAX(v.versionNo) FROM dbo.PricingVersions v WHERE v.sheetId = s.id) AS latestVersionNo
      FROM dbo.PricingSheets s
      WHERE (s.sheetKey LIKE @q OR s.name LIKE @q
        OR EXISTS (SELECT 1 FROM dbo.PricingItems pi
                   JOIN dbo.PricingVersions pv ON pv.id = pi.versionId
                   WHERE pv.sheetId = s.id AND (pi.materialCode LIKE @q OR pi.materialName LIKE @q)))
    `;
    if (departmentId) {
      q += ` AND (s.departmentId = @departmentId OR s.departmentId IS NULL)`;
      request.input("departmentId", sql.NVarChar(50), departmentId);
    }
    q += ` ORDER BY s.updatedAt DESC`;
    const result = await request.query(q);
    return (result.recordset || []).map((r: Record<string, unknown>) => ({
      id: String(r.id || ""),
      key: decodePricingSheetKey(String(r.sheetKey || "")),
      name: String(r.name || ""),
      versionCount: Number(r.versionCount) || 0,
      latestVersionNo: Number(r.latestVersionNo) || 0,
      updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : String(r.updatedAt || ""),
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt || ""),
      createdBy: r.createdBy ? String(r.createdBy) : undefined,
      departmentId: r.departmentId ? String(r.departmentId) : undefined,
    }));
  });
}

// --- Stats for dashboard ---

export async function getPricingStatsFromSql(): Promise<{
  totalSheets: number;
  totalVersions: number;
  recentUpdates: number;
}> {
  return withPool(async (pool) => {
    await ensureTables(pool);
    const result = await pool.request().query(`
      SELECT
        (SELECT COUNT(*) FROM dbo.PricingSheets) AS totalSheets,
        (SELECT COUNT(*) FROM dbo.PricingVersions) AS totalVersions,
        (SELECT COUNT(*) FROM dbo.PricingSheets WHERE updatedAt >= DATEADD(DAY, -7, GETDATE())) AS recentUpdates
    `);
    const row = result.recordset?.[0];
    return {
      totalSheets: Number(row?.totalSheets) || 0,
      totalVersions: Number(row?.totalVersions) || 0,
      recentUpdates: Number(row?.recentUpdates) || 0,
    };
  });
}
