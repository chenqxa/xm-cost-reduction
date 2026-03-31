import { formTemplates, initialProjects, initialTasks, users } from "@/lib/data";
import { AppSettings, BomDiffItem, BomMaterialAdjustment, BomTraceItem, FormTemplate, FormsDataSource, PricingColumn, PricingDiff, PricingItem, PricingLog, PricingSheet, PricingSheetSummary, PricingVersion, Project, ProjectMemberRole, Task, User, ThemeOption } from "@/types";
import { hasPricingSqlConfig, getPricingSheetListFromSql, getPricingSheetByIdFromSql, addPricingSheetVersionToSql, addPricingLogToSql, getPricingLogsFromSql, searchPricingSheetsFromSql, getPricingStatsFromSql } from "./pricing-db";
import fs from "node:fs";
import path from "node:path";
import sql from "mssql";

let userStore: User[] = users.map((user) => ({ ...user }));
let projectStore: Project[] = [...initialProjects];
let taskStore: Task[] = [...initialTasks];
let formTemplateStore: FormTemplate[] = [...formTemplates];
let pricingSheetStore: PricingSheet[] = [];
let appSettingsStore: AppSettings = (() => {
  const sqlConn = process.env.XM_SQLSERVER_CONNECTION_STRING || "";
  const sqlTable = process.env.XM_SQLSERVER_TABLE || "ICBom";

  const upstream = process.env.XM_FORMS_API_URL || process.env.FORMS_DB_API_URL || "";
  const upstreamKey = process.env.XM_FORMS_API_KEY || process.env.FORMS_DB_API_KEY || "";

  const baseTheme: ThemeOption = "graphite";
  if (sqlConn && sqlTable) {
    return {
      theme: baseTheme,
      forms: {
        source: "sqlserver",
        sqlServer: {
          connectionString: sqlConn,
          table: sqlTable,
          limit: Number(process.env.XM_SQLSERVER_FORMS_LIMIT || "50") || 50,
        },
      },
    };
  }
  if (upstream) {
    return {
      theme: baseTheme,
      forms: {
        source: "upstream",
        upstream: {
          url: upstream,
          apiKey: upstreamKey || undefined,
        },
      },
    };
  }
  return { theme: baseTheme, forms: { source: "local" } };
})();

const storeFilePath = path.join(process.cwd(), ".pm-store.json");

const createId = (prefix: string) => `${prefix}${Math.random().toString(36).slice(2, 9)}`;
const normalizePricingHeader = (value: string) => value.toLowerCase().replace(/\s+/g, "").replace(/[_\-()（）]/g, "");
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
const findPricingColumnKey = (columns: PricingColumn[] | undefined, labels: string[]) => {
  if (!Array.isArray(columns) || columns.length === 0) return "";
  const normalizedLabels = labels.map((label) => normalizePricingHeader(label));
  let best: { key: string; score: number } = { key: "", score: -1 };
  columns.forEach((column, index) => {
    const normalized = normalizePricingHeader(String(column.label || ""));
    if (!normalized) return;
    const score = normalizedLabels.findIndex((label) => normalized.includes(label));
    if (score >= 0) {
      const weighted = (normalizedLabels.length - score) * 1000 - index;
      if (weighted > best.score) best = { key: column.key, score: weighted };
    }
  });
  return best.key;
};
const migratePricingSheetAmounts = () => {
  let changed = false;
  pricingSheetStore = pricingSheetStore.map((sheet) => {
    let sheetChanged = false;
    const versions = (sheet.versions || []).map((version) => {
      let versionChanged = false;
      const amountKey = findPricingColumnKey(version.columns, ["含税金额", "不含税金额", "本币金额", "物料金额", "材料金额", "采购金额", "总金额", "金额", "totalamount", "amount"]);
      const unitPriceKey = findPricingColumnKey(version.columns, ["含税单价", "不含税单价", "材料单价", "采购单价", "单价", "核价", "价格", "unitprice", "price"]);
      const qtyKey = findPricingColumnKey(version.columns, ["数量", "用量", "采购数量", "qty"]);
      const items = (version.items || []).map((item) => {
        const fieldAmount = amountKey ? readPricingNumber(item.fields?.[amountKey]) : Number.NaN;
        const fieldUnitPrice = unitPriceKey ? readPricingNumber(item.fields?.[unitPriceKey]) : Number.NaN;
        const fieldQty = qtyKey ? readPricingNumber(item.fields?.[qtyKey]) : Number.NaN;
        const nextAmount = Number.isFinite(fieldAmount)
          ? fieldAmount
          : (Number.isFinite(fieldUnitPrice) && Number.isFinite(fieldQty) ? fieldUnitPrice * fieldQty : readPricingNumber(item.amount));
        const fallbackAmount = Number.isFinite(nextAmount) ? nextAmount : readPricingNumber(item.price);
        const normalizedAmount = Number.isFinite(fallbackAmount) ? fallbackAmount : 0;
        const normalizedPrice = Number.isFinite(fieldUnitPrice) ? fieldUnitPrice : readPricingNumber(item.price);
        const nextItem: PricingItem = {
          ...item,
          amount: normalizedAmount,
        };
        if (Number.isFinite(normalizedPrice)) nextItem.price = normalizedPrice;
        if ((item.amount ?? Number.NaN) !== nextItem.amount || (item.price ?? Number.NaN) !== (nextItem.price ?? Number.NaN)) {
          changed = true;
          versionChanged = true;
        }
        return nextItem;
      });
      if (versionChanged) sheetChanged = true;
      return versionChanged ? { ...version, items } : version;
    });
    return sheetChanged ? { ...sheet, versions } : sheet;
  });
  return changed;
};

const normalizeProjects = () => {
  let changed = false;
  const validUserIds = new Set(userStore.map((u) => u.id));

  projectStore = projectStore.map((project) => {
    const base: Project = { ...project };
    const nextRoles: Record<string, ProjectMemberRole> = {};

    if (base.memberRoles && typeof base.memberRoles === "object") {
      for (const [userId, role] of Object.entries(base.memberRoles)) {
        if (!validUserIds.has(userId)) continue;
        if (role === "owner" || role === "pm" || role === "member" || role === "viewer") {
          nextRoles[userId] = role;
        }
      }
    }

    if (Object.keys(nextRoles).length === 0) {
      for (const userId of base.memberIds || []) {
        if (!validUserIds.has(userId)) continue;
        nextRoles[userId] = "member";
      }
    }

    if (base.creatorId && validUserIds.has(base.creatorId)) {
      nextRoles[base.creatorId] = "owner";
    }

    const nextMemberIds = Array.from(new Set(Object.keys(nextRoles)));
    const sameIds =
      Array.isArray(base.memberIds) &&
      base.memberIds.length === nextMemberIds.length &&
      base.memberIds.every((id) => nextMemberIds.includes(id));
    const sameRoles =
      base.memberRoles &&
      Object.keys(base.memberRoles).length === Object.keys(nextRoles).length &&
      Object.entries(nextRoles).every(([id, role]) => base.memberRoles?.[id] === role);

    if (!sameIds || !sameRoles) {
      changed = true;
      return { ...base, memberIds: nextMemberIds, memberRoles: nextRoles };
    }
    return base;
  });

  if (changed) persistToDisk();
};

const syncFromDisk = () => {
  try {
    if (!fs.existsSync(storeFilePath)) {
      fs.writeFileSync(
        storeFilePath,
        JSON.stringify(
        {
          users: userStore,
          projects: projectStore,
          tasks: taskStore,
          formTemplates: formTemplateStore,
          appSettings: appSettingsStore,
          pricingSheets: pricingSheetStore,
        },
          null,
          2
        ),
        "utf8"
      );
      return;
    }
    const raw = fs.readFileSync(storeFilePath, "utf8");
    const parsed = JSON.parse(raw) as {
      users?: User[];
      projects?: Project[];
      tasks?: Task[];
      formTemplates?: FormTemplate[];
      appSettings?: AppSettings;
      pricingSheets?: PricingSheet[];
    };
    if (Array.isArray(parsed.users)) userStore = parsed.users;
    if (Array.isArray(parsed.projects)) projectStore = parsed.projects;
    if (Array.isArray(parsed.tasks)) taskStore = parsed.tasks;
    if (Array.isArray(parsed.formTemplates) && parsed.formTemplates.length > 0) {
      formTemplateStore = parsed.formTemplates;
    }
    if (Array.isArray(parsed.pricingSheets)) pricingSheetStore = parsed.pricingSheets;
    if (migratePricingSheetAmounts()) persistToDisk();
    if (parsed.appSettings && typeof parsed.appSettings === "object") {
      appSettingsStore = parsed.appSettings;
    }
    if (!appSettingsStore.theme) {
      appSettingsStore = { ...appSettingsStore, theme: "graphite" };
    }
    normalizeProjects();
  } catch {}
};

const persistToDisk = () => {
  try {
    fs.writeFileSync(
      storeFilePath,
      JSON.stringify(
        {
          users: userStore,
          projects: projectStore,
          tasks: taskStore,
          formTemplates: formTemplateStore,
          appSettings: appSettingsStore,
          pricingSheets: pricingSheetStore,
        },
        null,
        2
      ),
      "utf8"
    );
  } catch {}
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

const normalizeSqlTableName = (value: string) => {
  const trimmed = value.trim();
  const safe = /^[A-Za-z0-9_.]+$/.test(trimmed) ? trimmed : "XMProjects";
  if (!safe.includes(".")) return `dbo.${safe}`;
  return safe;
};

const readSqlString = (value: unknown) => {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
};

const readSqlOptionalString = (value: unknown) => {
  const text = readSqlString(value);
  return text ? text : undefined;
};

const readSqlNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Number.NaN;
};

const readSqlRecordValue = (record: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    if (key in record) {
      const value = readSqlString(record[key]);
      if (value) return value;
    }
  }
  return "";
};

const readSqlRecordNumber = (record: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    if (key in record) {
      const value = readSqlNumber(record[key]);
      if (Number.isFinite(value)) return value;
    }
  }
  return 0;
};

const parseJsonArray = <T,>(value: unknown, fallback: T[]): T[] => {
  if (Array.isArray(value)) return value as T[];
  if (typeof value !== "string" || !value.trim()) return fallback;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
};

const parseJsonRecord = <T extends Record<string, unknown>>(value: unknown, fallback: T): T => {
  if (value && typeof value === "object") return value as T;
  if (typeof value !== "string" || !value.trim()) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
};

const hasSqlColumn = async (pool: sql.ConnectionPool, tableName: string, columnName: string) => {
  const result = await pool
    .request()
    .query(`SELECT COL_LENGTH('${tableName}', '${columnName}') AS len`);
  const value = Array.isArray(result.recordset) ? result.recordset[0]?.len : null;
  return typeof value === "number" && value > 0;
};

const getProjectVisibilityColumns = async (pool: sql.ConnectionPool, tableName: string) => {
  const [company, department] = await Promise.all([
    hasSqlColumn(pool, tableName, "companyId"),
    hasSqlColumn(pool, tableName, "departmentId"),
  ]);
  return { company, department };
};

const buildProjectVisibilityWhere = (columns: { company: boolean; department: boolean }) => {
  const clauses: string[] = [];
  if (columns.company) {
    clauses.push("(@companyId = '' OR companyId = @companyId OR companyId IS NULL OR companyId = '')");
  }
  if (columns.department) {
    clauses.push(
      "(@isAdmin = 1 OR @departmentId = '' OR departmentId = @departmentId OR departmentId IS NULL OR departmentId = '')"
    );
  }
  if (clauses.length === 0) return "";
  return `WHERE ${clauses.join(" AND ")}`;
};

const resolveProjectIdColumn = async (pool: sql.ConnectionPool, tableName: string) => {
  const candidates = [
    "id",
    "projectId",
    "project_id",
    "projectID",
    "FID",
    "FProjectID",
    "FProjectId",
    "FId",
    "F_ID",
    "FInterID",
    "interId",
  ];
  for (const candidate of candidates) {
    if (await hasSqlColumn(pool, tableName, candidate)) return candidate;
  }
  return null;
};

const toProjectFromSqlRow = (row: Record<string, unknown>): Project | null => {
  const id = readSqlRecordValue(row, [
    "id",
    "projectId",
    "project_id",
    "projectID",
    "FID",
    "FProjectID",
    "FProjectId",
    "FId",
    "F_ID",
    "FInterID",
    "interId",
  ]);
  const name = readSqlRecordValue(row, [
    "name",
    "projectName",
    "project_name",
    "ProjectName",
    "xmmc",
    "FName",
    "FProjectName",
    "F_ProjectName",
    "title",
  ]);
  if (!id || !name) return null;
  const memberIds = parseJsonArray<string>(row.memberIds, []);
  const memberRoles = parseJsonRecord<Record<string, ProjectMemberRole>>(row.memberRoles, {});
  const bomDiffItems = parseJsonArray<BomDiffItem>(row.bomDiffItems, []);
  const bomMaterialAdjustments = parseJsonArray<BomMaterialAdjustment>(
    row.bomMaterialAdjustments,
    []
  );
  const bomDiffTraceItems = parseJsonArray<BomTraceItem[]>(row.bomDiffTraceItems, []);
  const bomRawReplaceTraceItems = parseJsonArray<BomTraceItem[]>(row.bomRawReplaceTraceItems, []);
  const bomDiffBaseOrder = parseJsonArray<string>(row.bomDiffBaseOrder, []);
  const bomDiffTargetOrder = parseJsonArray<string>(row.bomDiffTargetOrder, []);
  return {
    id,
    name,
    description: readSqlRecordValue(row, [
      "description",
      "projectDesc",
      "project_desc",
      "FDescription",
      "FDescribe",
      "xmmb",
    ]),
    progress: Number(row.progress) || 0,
    type: (readSqlString(row.type) as Project["type"]) || "department",
    departmentId: readSqlOptionalString(row.departmentId),
    salesOrderNo: readSqlRecordValue(row, ["salesOrderNo", "sales_order_no", "xsddh", "XS_DDH"]),
    formTemplateId: readSqlOptionalString(row.formTemplateId),
    formTemplateName: readSqlOptionalString(row.formTemplateName),
    bomChangeType: readSqlOptionalString(row.bomChangeType) as Project["bomChangeType"] | undefined,
    bomTargetId: readSqlOptionalString(row.bomTargetId),
    bomTargetName: readSqlOptionalString(row.bomTargetName),
    bomDiffItems,
    bomMaterialAdjustments,
    bomDiffTraceItems,
    bomRawReplaceTraceItems,
    bomDiffBaseOrder,
    bomDiffTargetOrder,
    memberIds,
    memberRoles,
    initiator: readSqlRecordValue(row, ["initiator", "lastname", "fqr", "FQRExt", "FInitiator"]),
    problem: readSqlRecordValue(row, ["problem", "wtd", "FProblem", "FDescribe"]),
    goal: readSqlRecordValue(row, ["goal", "xmmb", "zyxq", "FGoal", "FTarget"]),
    actions: readSqlRecordValue(row, ["actions", "zycs", "FAction", "FMeasure"]),
    resources: readSqlRecordValue(row, ["resources", "tdcywb", "FResource"]),
    cycle: readSqlRecordValue(row, ["cycle", "FPeriod", "FDuration"]),
    benefit: readSqlRecordValue(row, ["benefit", "FBenefit", "FProfit"]),
    approval: readSqlRecordValue(row, ["approval", "FApproval", "FDecision"]),
    createdAt: readSqlRecordValue(row, ["createdAt", "created_at", "createTime", "createdTime", "FEntertime"]),
    companyId: readSqlString(row.companyId),
    creatorId: readSqlString(row.creatorId),
  };
};

type ProjectSummaryItem = Pick<
  Project,
  | "id"
  | "name"
  | "description"
  | "progress"
  | "type"
  | "departmentId"
  | "bomChangeType"
  | "initiator"
  | "goal"
  | "cycle"
  | "salesOrderNo"
  | "benefit"
  | "createdAt"
  | "companyId"
  | "creatorId"
>;

const toProjectSummaryFromSqlRow = (row: Record<string, unknown>): ProjectSummaryItem | null => {
  const id = readSqlRecordValue(row, [
    "id",
    "projectId",
    "project_id",
    "projectID",
    "FID",
    "FProjectID",
    "FProjectId",
    "FId",
    "F_ID",
    "FInterID",
    "interId",
  ]);
  const name = readSqlRecordValue(row, [
    "name",
    "projectName",
    "project_name",
    "ProjectName",
    "xmmc",
    "FName",
    "FProjectName",
    "F_ProjectName",
    "title",
  ]);
  if (!id || !name) return null;
  return {
    id,
    name,
    description: readSqlRecordValue(row, [
      "description",
      "projectDesc",
      "project_desc",
      "FDescription",
      "FDescribe",
      "xmmb",
    ]),
    progress: Number(row.progress) || 0,
    type: (readSqlString(row.type) as Project["type"]) || "department",
    departmentId: readSqlOptionalString(row.departmentId),
    bomChangeType: readSqlOptionalString(row.bomChangeType) as Project["bomChangeType"] | undefined,
    initiator: readSqlRecordValue(row, ["initiator", "lastname", "fqr", "FQRExt", "FInitiator"]),
    goal: readSqlRecordValue(row, ["goal", "xmmb", "zyxq", "FGoal", "FTarget"]),
    cycle: readSqlRecordValue(row, ["cycle", "FPeriod", "FDuration"]),
    salesOrderNo: readSqlRecordValue(row, ["salesOrderNo", "sales_order_no", "xsddh", "XS_DDH"]),
    benefit: readSqlRecordValue(row, ["benefit", "FBenefit", "FProfit"]),
    createdAt: readSqlRecordValue(row, ["createdAt", "created_at", "createTime", "createdTime", "FEntertime"]),
    companyId: readSqlString(row.companyId),
    creatorId: readSqlString(row.creatorId),
  };
};

const mergeProjectWithFallback = (primary: Project, fallback: Project) => ({
  ...primary,
  name: primary.name || fallback.name,
  description: primary.description || fallback.description,
  progress: Number.isFinite(primary.progress) ? primary.progress : fallback.progress,
  type: primary.type || fallback.type,
  departmentId: primary.departmentId || fallback.departmentId,
  companyId: primary.companyId || fallback.companyId,
  creatorId: primary.creatorId || fallback.creatorId,
  initiator: primary.initiator || fallback.initiator,
  problem: primary.problem || fallback.problem,
  goal: primary.goal || fallback.goal,
  actions: primary.actions || fallback.actions,
  resources: primary.resources || fallback.resources,
  cycle: primary.cycle || fallback.cycle,
  salesOrderNo: primary.salesOrderNo || fallback.salesOrderNo,
  benefit: primary.benefit || fallback.benefit,
  approval: primary.approval || fallback.approval,
  formTemplateId: primary.formTemplateId ?? fallback.formTemplateId,
  formTemplateName: primary.formTemplateName ?? fallback.formTemplateName,
  bomChangeType: primary.bomChangeType ?? fallback.bomChangeType,
  bomTargetId: primary.bomTargetId ?? fallback.bomTargetId,
  bomTargetName: primary.bomTargetName ?? fallback.bomTargetName,
  bomDiffItems: (primary.bomDiffItems?.length ?? 0) > 0 ? primary.bomDiffItems : fallback.bomDiffItems,
  bomMaterialAdjustments:
    (primary.bomMaterialAdjustments?.length ?? 0) > 0
      ? primary.bomMaterialAdjustments
      : fallback.bomMaterialAdjustments,
  bomDiffTraceItems:
    (primary.bomDiffTraceItems?.length ?? 0) > 0 ? primary.bomDiffTraceItems : fallback.bomDiffTraceItems,
  bomRawReplaceTraceItems:
    (primary.bomRawReplaceTraceItems?.length ?? 0) > 0
      ? primary.bomRawReplaceTraceItems
      : fallback.bomRawReplaceTraceItems,
  bomDiffBaseOrder:
    (primary.bomDiffBaseOrder?.length ?? 0) > 0 ? primary.bomDiffBaseOrder : fallback.bomDiffBaseOrder,
  bomDiffTargetOrder:
    (primary.bomDiffTargetOrder?.length ?? 0) > 0 ? primary.bomDiffTargetOrder : fallback.bomDiffTargetOrder,
  memberIds: (primary.memberIds?.length ?? 0) > 0 ? primary.memberIds : fallback.memberIds,
  memberRoles:
    Object.keys(primary.memberRoles ?? {}).length > 0 ? primary.memberRoles : fallback.memberRoles,
  createdAt: primary.createdAt || fallback.createdAt,
});

const projectSqlTables = new Set<string>();
const globalForProjectSql = globalThis as unknown as {
  __xmProjectSqlPool?: sql.ConnectionPool;
  __xmProjectSqlKey?: string;
};

const getProjectSqlConfig = () => {
  const connectionString =
    process.env.XM_SQLSERVER_CONNECTION_STRING ||
    process.env.SQLSERVER_CONNECTION_STRING ||
    process.env.SQL_SERVER_CONNECTION_STRING ||
    appSettingsStore.forms.sqlServer?.connectionString ||
    "";
  if (!connectionString) return null;
  const table = normalizeSqlTableName(
    process.env.XM_SQLSERVER_PROJECTS_TABLE ||
      process.env.SQL_SERVER_PROJECTS_TABLE ||
      process.env.SQLSERVER_PROJECTS_TABLE ||
      "XMProjects"
  );
  return { connectionString, table };
};

const getProjectSqlQuery = () =>
  process.env.XM_SQLSERVER_PROJECTS_SQL ||
  process.env.SQL_SERVER_PROJECTS_SQL ||
  process.env.SQLSERVER_PROJECTS_SQL ||
  "";

const resolveOutstockConnection = () => {
  const explicit =
    process.env.XM_SQLSERVER_OUTSTOCK_CONNECTION_STRING ||
    process.env.SQL_SERVER_OUTSTOCK_CONNECTION_STRING ||
    process.env.SQLSERVER_OUTSTOCK_CONNECTION_STRING ||
    "";
  const explicitTrimmed = explicit.trim();
  if (explicitTrimmed) {
    return {
      connectionString: explicitTrimmed,
      source: "outstock" as const,
      explicitLength: explicitTrimmed.length,
    };
  }
  const fallback = getProjectSqlConfig()?.connectionString || "";
  if (fallback) {
    return { connectionString: fallback, source: "project" as const, explicitLength: 0 };
  }
  return { connectionString: "", source: "none" as const, explicitLength: 0 };
};

const getOutstockSqlConfig = () => {
  const resolved = resolveOutstockConnection();
  const query =
    process.env.XM_SQLSERVER_OUTSTOCK_SQL ||
    process.env.SQL_SERVER_OUTSTOCK_SQL ||
    process.env.SQLSERVER_OUTSTOCK_SQL ||
    "";
  if (!resolved.connectionString || !query) return null;
  return { connectionString: resolved.connectionString, query };
};

const getOutstockLastCostConfig = () => {
  const resolved = resolveOutstockConnection();
  const query =
    process.env.XM_SQLSERVER_OUTSTOCK_LAST_COST_SQL ||
    process.env.SQL_SERVER_OUTSTOCK_LAST_COST_SQL ||
    process.env.SQLSERVER_OUTSTOCK_LAST_COST_SQL ||
    "";
  if (!resolved.connectionString || !query) return null;
  return { connectionString: resolved.connectionString, query };
};

type OutstockBenefit = {
  totalQty: number;
  salesAmount: number;
  costAmount: number;
  baseCostAmount: number;
  profit: number;
  profitRate: number | null;
  benefitText: string;
};

export type OutstockBenefitDebug = {
  orderNo: string;
  orderNoNormalized: string;
  orderNoLength: number;
  baseBomId: string;
  baseBomName: string;
  baseBomNameCandidates: string[];
  baseBomCodeUsed: string;
  lastCostMaterialCodeUsed: string;
  lastCostCustomerId: string;
  lastCostCustomerCandidates: string[];
  lastCostBillNo: string;
  lastCostBillDate: string;
  lastCostUnitCost: number | null;
  lastCostResolvedMaterialCode: string;
  lastCostResolvedItemId: string;
  outstockEnvLength: number;
  hasOutstockSql: boolean;
  hasLastCostSql: boolean;
  outstockConnectionSource: "outstock" | "project" | "none";
  lastCostConnectionSource: "outstock" | "project" | "none";
  outstockDatabaseName: string;
  outstockServerName: string;
  outstockErrorMessage: string;
  lineCount: number;
  baseBomCount: number;
  baseBomMatchedLines: number;
  baseBomCodes: string[];
  totals: {
    totalQty: number;
    salesAmount: number;
    costAmount: number;
    baseCostAmount: number;
    benefitText: string;
  };
  sampleLines: Array<{
    customerId: string;
    materialCode: string;
    materialName: string;
    qty: number;
    costAmount: number;
  }>;
};

type OutstockLine = {
  customerId: string;
  materialCode: string;
  materialName: string;
  qty: number;
  costAmount: number;
  salesAmount: number;
  baseCostAmount: number;
};

const getSqlConnectionInfo = async (
  connectionString: string
): Promise<{ databaseName: string; serverName: string } | null> => {
  if (!connectionString) return null;
  try {
    return await withProjectSqlPool(connectionString, async (pool) => {
      const result = await pool.request().query("SELECT DB_NAME() AS dbName, @@SERVERNAME AS serverName");
      const row = Array.isArray(result.recordset) ? result.recordset[0] : null;
      if (!row) return null;
      return {
        databaseName: readSqlRecordValue(row, ["dbName", "DB_NAME", "dbname"]),
        serverName: readSqlRecordValue(row, ["serverName", "@@SERVERNAME", "servername"]),
      };
    });
  } catch {
    return null;
  }
};

const getBomCodeCandidates = (value: string) => {
  if (!value) return [];
  const matches = value.match(/[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+/g) || [];
  return matches.map((item) => item.trim()).filter(Boolean);
};

const splitOrderNos = (value: string) => {
  if (!value) return [];
  const parts = value
    .split(/[\s,;，、]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
  return Array.from(new Set(parts));
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
  if (cleaned) return `SQL Server 查询失败：${cleaned}`;
  return "SQL Server 查询失败";
};

const mapOutstockRow = (row: Record<string, unknown>): OutstockLine => ({
  customerId: readSqlRecordValue(row, ["customerId", "customer", "FSupplyID", "FCustID"]),
  materialCode: readSqlRecordValue(row, ["materialCode", "FNumber", "itemCode", "material"]),
  materialName: readSqlRecordValue(row, ["materialName", "FName", "itemName", "materialName"]),
  qty: readSqlRecordNumber(row, ["qty", "quantity", "FAuxQty", "FQty"]),
  costAmount: readSqlRecordNumber(row, [
    "costAmount",
    "cost",
    "FCostAmount",
    "FAllCost",
    "FCostTotal",
    "FEntryCost",
    "FAmountCost",
  ]),
  salesAmount: readSqlRecordNumber(row, [
    "salesAmount",
    "saleAmount",
    "amount",
    "FAmount",
    "FAllAmount",
    "FSourceAmount",
    "FTaxAmount",
    "FSubTotal",
  ]),
  baseCostAmount: readSqlRecordNumber(row, [
    "baseCostAmount",
    "originalCost",
    "standardCostAmount",
    "FStandardCostAmount",
    "FBaseCost",
    "FStandardAmount",
  ]),
});

const getOutstockLinesByOrderNos = async (orderNos: string[]): Promise<OutstockLine[]> => {
  const config = getOutstockSqlConfig();
  if (!config || orderNos.length === 0) return [];
  try {
    return await withProjectSqlPool(config.connectionString, async (pool) => {
      const lines: OutstockLine[] = [];
      for (const orderNo of orderNos) {
        const request = pool.request();
        request.input("orderNo", sql.NVarChar(128), orderNo);
        const result = await request.query(config.query);
        const rows = Array.isArray(result.recordset) ? result.recordset : [];
        lines.push(...rows.map((row) => mapOutstockRow(row as Record<string, unknown>)));
      }
      return lines;
    });
  } catch {
    return [];
  }
};

const getOutstockLinesWithError = async (
  orderNos: string[]
): Promise<{ lines: OutstockLine[]; errorMessage: string }> => {
  const config = getOutstockSqlConfig();
  if (!config || orderNos.length === 0) return { lines: [], errorMessage: "" };
  try {
    const lines = await withProjectSqlPool(config.connectionString, async (pool) => {
      const output: OutstockLine[] = [];
      for (const orderNo of orderNos) {
        const request = pool.request();
        request.input("orderNo", sql.NVarChar(128), orderNo);
        const result = await request.query(config.query);
        const rows = Array.isArray(result.recordset) ? result.recordset : [];
        output.push(...rows.map((row) => mapOutstockRow(row as Record<string, unknown>)));
      }
      return output;
    });
    return { lines, errorMessage: "" };
  } catch (error) {
    return { lines: [], errorMessage: formatSqlErrorMessage(error) };
  }
};

const getOutstockLastUnitCost = async (
  customerId: string,
  materialCode: string
): Promise<number | null> => {
  const config = getOutstockLastCostConfig();
  if (!config || !customerId || !materialCode) return null;
  try {
    return await withProjectSqlPool(config.connectionString, async (pool) => {
      const request = pool.request();
      request.input("customerId", sql.NVarChar(128), customerId);
      request.input("materialCode", sql.NVarChar(128), materialCode);
      const result = await request.query(config.query);
      const row = Array.isArray(result.recordset) ? result.recordset[0] : null;
      if (!row) return null;
      const unitCost = readSqlRecordNumber(row, [
        "lastUnitCost",
        "unitCost",
        "FAuxPrice",
        "FPrice",
        "FUnitCost",
      ]);
      return Number.isFinite(unitCost) ? unitCost : null;
    });
  } catch {
    return null;
  }
};

const getOutstockLastUnitCostDetail = async (
  customerId: string,
  materialCode: string
): Promise<{
  unitCost: number | null;
  billNo: string;
  billDate: string;
  resolvedMaterialCode: string;
  resolvedItemId: string;
} | null> => {
  const config = getOutstockLastCostConfig();
  if (!config || !customerId || !materialCode) return null;
  try {
    return await withProjectSqlPool(config.connectionString, async (pool) => {
      const request = pool.request();
      request.input("customerId", sql.NVarChar(128), customerId);
      request.input("materialCode", sql.NVarChar(128), materialCode);
      const result = await request.query(config.query);
      const row = Array.isArray(result.recordset) ? result.recordset[0] : null;
      if (!row) return null;
      const unitCost = readSqlRecordNumber(row, [
        "lastUnitCost",
        "unitCost",
        "FAuxPrice",
        "FPrice",
        "FUnitCost",
      ]);
      return {
        unitCost: Number.isFinite(unitCost) ? unitCost : null,
        billNo: readSqlRecordValue(row, ["lastBillNo", "FBillNo", "billNo"]),
        billDate: readSqlRecordValue(row, ["lastBillDate", "FDate", "billDate"]),
        resolvedMaterialCode: readSqlRecordValue(row, [
          "resolvedMaterialCode",
          "materialCode",
          "FNumber",
        ]),
        resolvedItemId: readSqlRecordValue(row, [
          "resolvedItemId",
          "FItemID",
          "itemId",
          "itemID",
        ]),
      };
    });
  } catch {
    return null;
  }
};

const getOutstockBenefitForProject = async (project: {
  salesOrderNo?: string;
  bomDiffItems?: BomDiffItem[];
  formTemplateId?: string;
  formTemplateName?: string;
}): Promise<OutstockBenefit | null> => {
  const orderNos = splitOrderNos(project.salesOrderNo || "");
  if (orderNos.length === 0) return null;
  const lines = await getOutstockLinesByOrderNos(orderNos);
  if (lines.length === 0) return null;
  const totalCostAmount = lines.reduce((sum, line) => sum + (line.costAmount || 0), 0);
  const totalSalesAmount = lines.reduce((sum, line) => sum + (line.salesAmount || 0), 0);
  const totalQty = lines.reduce((sum, line) => sum + (line.qty || 0), 0);
  const baseCostFromRows = lines.reduce((sum, line) => sum + (line.baseCostAmount || 0), 0);
  let baseCostAmount = baseCostFromRows;
  const baseBomId = project.formTemplateId || "";
  const baseBomName = project.formTemplateName || "";
  const baseBomNameCandidates = getBomCodeCandidates(baseBomName);
  const baseBomCodeUsed = baseBomNameCandidates[baseBomNameCandidates.length - 1] || baseBomId;
  if (baseBomCodeUsed) {
    baseCostAmount = 0;
    const costCache = new Map<string, number>();
    for (const line of lines) {
      const cacheKey = `${line.customerId}__${baseBomCodeUsed}`;
      if (!costCache.has(cacheKey)) {
        const lastUnitCost = await getOutstockLastUnitCost(line.customerId, baseBomCodeUsed);
        if (lastUnitCost !== null) {
          costCache.set(cacheKey, lastUnitCost);
        }
      }
      const unitCost = costCache.get(cacheKey);
      if (typeof unitCost === "number") {
        baseCostAmount += (line.qty || 0) * unitCost;
      } else {
        baseCostAmount += line.costAmount || 0;
      }
    }
  } else {
    const baseBomCodes = new Set(
      (Array.isArray(project.bomDiffItems) ? project.bomDiffItems : [])
        .filter((item) => item.materialCode && item.baseQty > 0)
        .map((item) => item.materialCode.trim())
        .filter(Boolean)
    );
    if (baseBomCodes.size > 0) {
      baseCostAmount = 0;
      const costCache = new Map<string, number>();
      for (const line of lines) {
        if (!baseBomCodes.has(line.materialCode)) {
          baseCostAmount += line.costAmount || 0;
          continue;
        }
        const cacheKey = `${line.customerId}__${line.materialCode}`;
        if (!costCache.has(cacheKey)) {
          const lastUnitCost = await getOutstockLastUnitCost(line.customerId, line.materialCode);
          if (lastUnitCost !== null) {
            costCache.set(cacheKey, lastUnitCost);
          }
        }
        const unitCost = costCache.get(cacheKey);
        if (typeof unitCost === "number") {
          baseCostAmount += (line.qty || 0) * unitCost;
        } else {
          baseCostAmount += line.costAmount || 0;
        }
      }
    }
  }
  const effectiveBase = baseCostAmount > 0 ? baseCostAmount : Number.NaN;
  const savings = Number.isFinite(effectiveBase) ? effectiveBase - totalCostAmount : Number.NaN;
  const savingsRate =
    Number.isFinite(savings) && effectiveBase > 0 ? (savings / effectiveBase) * 100 : null;
  const profit = totalSalesAmount - totalCostAmount;
  const profitRate = totalCostAmount > 0 ? (profit / totalCostAmount) * 100 : null;
  let benefitText = `¥${profit.toFixed(2)}`;
  if (profitRate !== null) {
    benefitText = `${benefitText} (毛利率 ${profitRate.toFixed(2)}%)`;
  }
  if (Number.isFinite(effectiveBase)) {
    const savingsText = `¥${savings.toFixed(2)}`;
    benefitText =
      savingsRate === null
        ? `节约 ${savingsText} (原成本 ¥${effectiveBase.toFixed(2)})`
        : `节约 ${savingsText} (节约率 ${savingsRate.toFixed(2)}%, 原成本 ¥${effectiveBase.toFixed(2)})`;
  }
  return {
    totalQty,
    salesAmount: totalSalesAmount,
    costAmount: totalCostAmount,
    baseCostAmount,
    profit,
    profitRate,
    benefitText,
  };
};

export const getOutstockBenefitDebug = async (project: {
  salesOrderNo?: string;
  bomDiffItems?: BomDiffItem[];
  formTemplateId?: string;
  formTemplateName?: string;
}): Promise<OutstockBenefitDebug | null> => {
  const orderNo = project.salesOrderNo || "";
  const orderNos = splitOrderNos(orderNo);
  const orderNoNormalized = orderNos.join(",");
  const baseBomId = project.formTemplateId || "";
  const baseBomName = project.formTemplateName || "";
  const baseBomNameCandidates = getBomCodeCandidates(baseBomName);
  const baseBomCodeUsed = baseBomNameCandidates[baseBomNameCandidates.length - 1] || baseBomId;
  const outstockResolved = resolveOutstockConnection();
  const hasOutstockSql = Boolean(getOutstockSqlConfig());
  const hasLastCostSql = Boolean(getOutstockLastCostConfig());
  const outstockConnectionSource = outstockResolved.source;
  const lastCostConnectionSource = outstockResolved.source;
  const outstockConnectionString = outstockResolved.connectionString;
  const outstockEnvLength = outstockResolved.explicitLength;
  const connectionInfo = await getSqlConnectionInfo(outstockConnectionString);
  if (orderNos.length === 0 || !hasOutstockSql) {
    return {
      orderNo,
      orderNoNormalized,
      orderNoLength: orderNoNormalized.length,
      baseBomId,
      baseBomName,
      baseBomNameCandidates,
      baseBomCodeUsed,
      lastCostMaterialCodeUsed: baseBomCodeUsed,
      lastCostCustomerId: "",
      lastCostCustomerCandidates: [],
      lastCostBillNo: "",
      lastCostBillDate: "",
      lastCostUnitCost: null,
      lastCostResolvedMaterialCode: "",
      lastCostResolvedItemId: "",
      outstockEnvLength,
      hasOutstockSql,
      hasLastCostSql,
      outstockConnectionSource,
      lastCostConnectionSource,
      outstockDatabaseName: connectionInfo?.databaseName || "",
      outstockServerName: connectionInfo?.serverName || "",
      outstockErrorMessage: "",
      lineCount: 0,
      baseBomCount: 0,
      baseBomMatchedLines: 0,
      baseBomCodes: [],
      totals: { totalQty: 0, salesAmount: 0, costAmount: 0, baseCostAmount: 0, benefitText: "—" },
      sampleLines: [],
    };
  }
  const outstockResult = await getOutstockLinesWithError(orderNos);
  const lines = outstockResult.lines;
  const outstockErrorMessage = outstockResult.errorMessage;
  const totalCostAmount = lines.reduce((sum, line) => sum + (line.costAmount || 0), 0);
  const totalSalesAmount = lines.reduce((sum, line) => sum + (line.salesAmount || 0), 0);
  const totalQty = lines.reduce((sum, line) => sum + (line.qty || 0), 0);
  const baseCostFromRows = lines.reduce((sum, line) => sum + (line.baseCostAmount || 0), 0);
  let baseCostAmount = baseCostFromRows;
  const lastCostCustomerCandidates = Array.from(
    new Set(lines.map((line) => line.customerId).filter(Boolean))
  );
  const lastCostCustomerId = lastCostCustomerCandidates[0] || "";
  const lastCostDetail =
    baseBomCodeUsed && lastCostCustomerId
      ? await getOutstockLastUnitCostDetail(lastCostCustomerId, baseBomCodeUsed)
      : null;
  const baseBomCodes = new Set(
    (Array.isArray(project.bomDiffItems) ? project.bomDiffItems : [])
      .filter((item) => item.materialCode && item.baseQty > 0)
      .map((item) => item.materialCode.trim())
      .filter(Boolean)
  );
  const baseBomList = baseBomCodeUsed ? [baseBomCodeUsed] : Array.from(baseBomCodes);
  const baseBomCount = baseBomList.length;
  let baseBomMatchedLines = 0;
  if (baseBomCodeUsed) {
    baseCostAmount = 0;
    baseBomMatchedLines = lines.length;
    const costCache = new Map<string, number>();
    for (const line of lines) {
      const cacheKey = `${line.customerId}__${baseBomCodeUsed}`;
      if (!costCache.has(cacheKey)) {
        const lastUnitCost = await getOutstockLastUnitCost(line.customerId, baseBomCodeUsed);
        if (lastUnitCost !== null) {
          costCache.set(cacheKey, lastUnitCost);
        }
      }
      const unitCost = costCache.get(cacheKey);
      if (typeof unitCost === "number") {
        baseCostAmount += (line.qty || 0) * unitCost;
      } else {
        baseCostAmount += line.costAmount || 0;
      }
    }
  } else if (baseBomCodes.size > 0) {
    baseCostAmount = 0;
    const costCache = new Map<string, number>();
    for (const line of lines) {
      if (!baseBomCodes.has(line.materialCode)) {
        baseCostAmount += line.costAmount || 0;
        continue;
      }
      baseBomMatchedLines += 1;
      const cacheKey = `${line.customerId}__${line.materialCode}`;
      if (!costCache.has(cacheKey)) {
        const lastUnitCost = await getOutstockLastUnitCost(line.customerId, line.materialCode);
        if (lastUnitCost !== null) {
          costCache.set(cacheKey, lastUnitCost);
        }
      }
      const unitCost = costCache.get(cacheKey);
      if (typeof unitCost === "number") {
        baseCostAmount += (line.qty || 0) * unitCost;
      } else {
        baseCostAmount += line.costAmount || 0;
      }
    }
  }
  const effectiveBase = baseCostAmount > 0 ? baseCostAmount : Number.NaN;
  const savings = Number.isFinite(effectiveBase) ? effectiveBase - totalCostAmount : Number.NaN;
  const savingsRate =
    Number.isFinite(savings) && effectiveBase > 0 ? (savings / effectiveBase) * 100 : null;
  const profit = totalSalesAmount - totalCostAmount;
  const profitRate = totalCostAmount > 0 ? (profit / totalCostAmount) * 100 : null;
  let benefitText = `¥${profit.toFixed(2)}`;
  if (profitRate !== null) {
    benefitText = `${benefitText} (毛利率 ${profitRate.toFixed(2)}%)`;
  }
  if (Number.isFinite(effectiveBase)) {
    const savingsText = `¥${savings.toFixed(2)}`;
    benefitText =
      savingsRate === null
        ? `节约 ${savingsText} (原成本 ¥${effectiveBase.toFixed(2)})`
        : `节约 ${savingsText} (节约率 ${savingsRate.toFixed(2)}%, 原成本 ¥${effectiveBase.toFixed(2)})`;
  }
  return {
    orderNo,
    orderNoNormalized,
    orderNoLength: orderNoNormalized.length,
    baseBomId,
    baseBomName,
    baseBomNameCandidates,
    baseBomCodeUsed,
    lastCostMaterialCodeUsed: baseBomCodeUsed,
    lastCostCustomerId,
    lastCostCustomerCandidates,
    lastCostBillNo: lastCostDetail?.billNo || "",
    lastCostBillDate: lastCostDetail?.billDate || "",
    lastCostUnitCost: lastCostDetail?.unitCost ?? null,
    lastCostResolvedMaterialCode: lastCostDetail?.resolvedMaterialCode || "",
    lastCostResolvedItemId: lastCostDetail?.resolvedItemId || "",
    outstockEnvLength,
    hasOutstockSql,
    hasLastCostSql,
    outstockConnectionSource,
    lastCostConnectionSource,
    outstockDatabaseName: connectionInfo?.databaseName || "",
    outstockServerName: connectionInfo?.serverName || "",
    outstockErrorMessage,
    lineCount: lines.length,
    baseBomCount,
    baseBomMatchedLines,
    baseBomCodes: baseBomList.slice(0, 50),
    totals: {
      totalQty,
      salesAmount: totalSalesAmount,
      costAmount: totalCostAmount,
      baseCostAmount,
      benefitText,
    },
    sampleLines: lines.slice(0, 5).map((line) => ({
      customerId: line.customerId,
      materialCode: line.materialCode,
      materialName: line.materialName,
      qty: line.qty,
      costAmount: line.costAmount,
    })),
  };
};

export type OutstockBenefitSummary = {
  orderNo: string;
  orderNoNormalized: string;
  lastCostMaterialCodeUsed: string;
  lastCostCustomerId: string;
  lastCostBillNo: string;
  lastCostBillDate: string;
  lastCostUnitCost: number | null;
  lastCostResolvedMaterialCode: string;
  lastCostResolvedItemId: string;
  lineCount: number;
  detailLines: Array<{
    materialCode: string;
    materialName: string;
    qty: number;
    costAmount: number;
  }>;
  totals: {
    totalQty: number;
    salesAmount: number;
    costAmount: number;
    baseCostAmount: number;
    benefitText: string;
  };
};

export const getOutstockBenefitSummary = async (project: {
  salesOrderNo?: string;
  bomDiffItems?: BomDiffItem[];
  formTemplateId?: string;
  formTemplateName?: string;
}): Promise<OutstockBenefitSummary | null> => {
  const debug = await getOutstockBenefitDebug(project);
  if (!debug || !debug.orderNoNormalized.trim() || debug.lineCount === 0) return null;
  return {
    orderNo: debug.orderNo,
    orderNoNormalized: debug.orderNoNormalized,
    lastCostMaterialCodeUsed: debug.lastCostMaterialCodeUsed,
    lastCostCustomerId: debug.lastCostCustomerId,
    lastCostBillNo: debug.lastCostBillNo,
    lastCostBillDate: debug.lastCostBillDate,
    lastCostUnitCost: debug.lastCostUnitCost,
    lastCostResolvedMaterialCode: debug.lastCostResolvedMaterialCode,
    lastCostResolvedItemId: debug.lastCostResolvedItemId,
    lineCount: debug.lineCount,
    detailLines: debug.sampleLines.map((line) => ({
      materialCode: line.materialCode,
      materialName: line.materialName,
      qty: line.qty,
      costAmount: line.costAmount,
    })),
    totals: debug.totals,
  };
};

const applyOutstockBenefit = async <T extends { benefit?: string; salesOrderNo?: string }>(
  project: T
): Promise<T> => {
  if (!project.salesOrderNo) return project;
  if (project.benefit && project.benefit.trim()) return project;
  const benefit = await getOutstockBenefitForProject(project);
  if (!benefit) return project;
  return { ...project, benefit: benefit.benefitText };
};

export const hasProjectSqlConfig = () => Boolean(getProjectSqlConfig());

const getProjectSqlPool = async (connectionString: string) => {
  const existing = globalForProjectSql.__xmProjectSqlPool;
  if (existing && globalForProjectSql.__xmProjectSqlKey === connectionString) {
    try {
      await existing.request().query("SELECT 1");
      return existing;
    } catch {
      globalForProjectSql.__xmProjectSqlPool = undefined;
      globalForProjectSql.__xmProjectSqlKey = undefined;
      try {
        await existing.close();
      } catch {
        globalForProjectSql.__xmProjectSqlPool = undefined;
        globalForProjectSql.__xmProjectSqlKey = undefined;
      }
    }
  }

  const normalized = normalizeSqlServerConnectionString(connectionString);
  const pool = new sql.ConnectionPool(normalized);
  pool.on("error", () => {
    globalForProjectSql.__xmProjectSqlPool = undefined;
    globalForProjectSql.__xmProjectSqlKey = undefined;
  });
  globalForProjectSql.__xmProjectSqlPool = pool;
  globalForProjectSql.__xmProjectSqlKey = connectionString;
  await pool.connect();
  return pool;
};

const resetProjectSqlPool = async () => {
  const existing = globalForProjectSql.__xmProjectSqlPool;
  globalForProjectSql.__xmProjectSqlPool = undefined;
  globalForProjectSql.__xmProjectSqlKey = undefined;
  if (existing) {
    try {
      await existing.close();
    } catch {}
  }
};

const withProjectSqlPool = async <T,>(
  connectionString: string,
  handler: (pool: sql.ConnectionPool) => Promise<T>
) => {
  try {
    const pool = await getProjectSqlPool(connectionString);
    return await handler(pool);
  } catch {
    await resetProjectSqlPool();
    const pool = await getProjectSqlPool(connectionString);
    return await handler(pool);
  }
};

const ensureProjectSqlTable = async (pool: sql.ConnectionPool, tableName: string) => {
  if (projectSqlTables.has(tableName)) return;
  const query = `
    IF OBJECT_ID(N'${tableName}', 'U') IS NULL
    BEGIN
      CREATE TABLE ${tableName} (
        id NVARCHAR(64) NOT NULL PRIMARY KEY,
        name NVARCHAR(200) NOT NULL,
        description NVARCHAR(MAX) NULL,
        progress INT NOT NULL,
        type NVARCHAR(32) NOT NULL,
        departmentId NVARCHAR(64) NULL,
        formTemplateId NVARCHAR(64) NULL,
        formTemplateName NVARCHAR(256) NULL,
        bomChangeType NVARCHAR(32) NULL,
        bomTargetId NVARCHAR(64) NULL,
        bomTargetName NVARCHAR(256) NULL,
        bomDiffItems NVARCHAR(MAX) NULL,
        bomMaterialAdjustments NVARCHAR(MAX) NULL,
        bomDiffTraceItems NVARCHAR(MAX) NULL,
        bomRawReplaceTraceItems NVARCHAR(MAX) NULL,
        bomDiffBaseOrder NVARCHAR(MAX) NULL,
        bomDiffTargetOrder NVARCHAR(MAX) NULL,
        memberIds NVARCHAR(MAX) NOT NULL,
        memberRoles NVARCHAR(MAX) NULL,
        initiator NVARCHAR(MAX) NULL,
        problem NVARCHAR(MAX) NULL,
        goal NVARCHAR(MAX) NULL,
        actions NVARCHAR(MAX) NULL,
        resources NVARCHAR(MAX) NULL,
        cycle NVARCHAR(MAX) NULL,
        benefit NVARCHAR(MAX) NULL,
        approval NVARCHAR(MAX) NULL,
        createdAt NVARCHAR(32) NOT NULL,
        companyId NVARCHAR(64) NOT NULL,
        creatorId NVARCHAR(64) NOT NULL
      )
    END
    IF COL_LENGTH('${tableName}', 'bomDiffTraceItems') IS NULL
    BEGIN
      ALTER TABLE ${tableName} ADD bomDiffTraceItems NVARCHAR(MAX) NULL
    END
    IF COL_LENGTH('${tableName}', 'bomRawReplaceTraceItems') IS NULL
    BEGIN
      ALTER TABLE ${tableName} ADD bomRawReplaceTraceItems NVARCHAR(MAX) NULL
    END
    IF COL_LENGTH('${tableName}', 'bomDiffBaseOrder') IS NULL
    BEGIN
      ALTER TABLE ${tableName} ADD bomDiffBaseOrder NVARCHAR(MAX) NULL
    END
    IF COL_LENGTH('${tableName}', 'bomDiffTargetOrder') IS NULL
    BEGIN
      ALTER TABLE ${tableName} ADD bomDiffTargetOrder NVARCHAR(MAX) NULL
    END
    IF COL_LENGTH('${tableName}', 'formTemplateName') IS NULL
    BEGIN
      ALTER TABLE ${tableName} ADD formTemplateName NVARCHAR(256) NULL
    END
    IF COL_LENGTH('${tableName}', 'bomTargetName') IS NULL
    BEGIN
      ALTER TABLE ${tableName} ADD bomTargetName NVARCHAR(256) NULL
    END
  `;
  await pool.request().query(query);
  projectSqlTables.add(tableName);
};

const ensureProjectDiffItemsTable = async (pool: sql.ConnectionPool) => {
  const itemsTable = normalizeSqlTableName("XMProjectDiffItems");
  const query = `
    IF OBJECT_ID(N'${itemsTable}', 'U') IS NULL
    BEGIN
      CREATE TABLE ${itemsTable} (
        id INT IDENTITY(1,1) PRIMARY KEY,
        projectId NVARCHAR(64) NOT NULL,
        seq INT NOT NULL,
        groupType NVARCHAR(16) NOT NULL,
        materialCode NVARCHAR(256) NULL,
        materialName NVARCHAR(512) NULL,
        baseQty FLOAT NOT NULL,
        targetQty FLOAT NOT NULL,
        delta FLOAT NOT NULL,
        itemId NVARCHAR(128) NULL
      );
      CREATE INDEX IX_${itemsTable.replace('.', '_')}_ProjectId ON ${itemsTable}(projectId);
    END
  `;
  await pool.request().query(query);
};

const ensureProjectDiffTraceItemsTable = async (pool: sql.ConnectionPool) => {
  const traceTable = normalizeSqlTableName("XMProjectDiffTraceItems");
  const query = `
    IF OBJECT_ID(N'${traceTable}', 'U') IS NULL
    BEGIN
      CREATE TABLE ${traceTable} (
        id INT IDENTITY(1,1) PRIMARY KEY,
        projectId NVARCHAR(64) NOT NULL,
        diffIndex INT NOT NULL,
        itemId NVARCHAR(128) NULL,
        materialCode NVARCHAR(256) NULL,
        materialName NVARCHAR(512) NULL,
        bomNumber NVARCHAR(128) NOT NULL,
        bomCode NVARCHAR(128) NULL,
        bomName NVARCHAR(256) NULL,
        auxQty FLOAT NOT NULL,
        audDate NVARCHAR(64) NULL
      );
      CREATE INDEX IX_${traceTable.replace('.', '_')}_ProjectId ON ${traceTable}(projectId);
      CREATE INDEX IX_${traceTable.replace('.', '_')}_BomNumber ON ${traceTable}(bomNumber);
    END
  `;
  await pool.request().query(query);
};

const getDiffOrderKey = (item: BomDiffItem) =>
  [item.itemId?.trim(), item.materialCode?.trim(), item.materialName?.trim()].filter(Boolean).join("::");

export async function persistProjectToSql(project: Project) {
  const config = getProjectSqlConfig();
  if (!config) return;
  try {
    await withProjectSqlPool(config.connectionString, async (pool) => {
      await ensureProjectSqlTable(pool, config.table);
      await ensureProjectDiffItemsTable(pool);
      await ensureProjectDiffTraceItemsTable(pool);
      const request = pool.request();
      request.input("id", sql.NVarChar(64), project.id);
      request.input("name", sql.NVarChar(200), project.name);
      request.input("description", sql.NVarChar(sql.MAX), project.description ?? "");
      request.input("progress", sql.Int, project.progress ?? 0);
      request.input("type", sql.NVarChar(32), project.type);
      request.input("departmentId", sql.NVarChar(64), project.departmentId ?? null);
      request.input("formTemplateId", sql.NVarChar(64), project.formTemplateId ?? null);
      request.input("formTemplateName", sql.NVarChar(256), project.formTemplateName ?? null);
      request.input("bomChangeType", sql.NVarChar(32), project.bomChangeType ?? null);
      request.input("bomTargetId", sql.NVarChar(64), project.bomTargetId ?? null);
      request.input("bomTargetName", sql.NVarChar(256), project.bomTargetName ?? null);
      request.input("bomDiffItems", sql.NVarChar(sql.MAX), JSON.stringify(project.bomDiffItems ?? []));
      request.input(
        "bomMaterialAdjustments",
        sql.NVarChar(sql.MAX),
        JSON.stringify(project.bomMaterialAdjustments ?? [])
      );
      request.input(
        "bomDiffTraceItems",
        sql.NVarChar(sql.MAX),
        JSON.stringify(project.bomDiffTraceItems ?? [])
      );
      request.input(
        "bomRawReplaceTraceItems",
        sql.NVarChar(sql.MAX),
        JSON.stringify(project.bomRawReplaceTraceItems ?? [])
      );
      request.input(
        "bomDiffBaseOrder",
        sql.NVarChar(sql.MAX),
        JSON.stringify(project.bomDiffBaseOrder ?? [])
      );
      request.input(
        "bomDiffTargetOrder",
        sql.NVarChar(sql.MAX),
        JSON.stringify(project.bomDiffTargetOrder ?? [])
      );
      request.input("memberIds", sql.NVarChar(sql.MAX), JSON.stringify(project.memberIds ?? []));
      request.input("memberRoles", sql.NVarChar(sql.MAX), project.memberRoles ? JSON.stringify(project.memberRoles) : null);
      request.input("initiator", sql.NVarChar(sql.MAX), project.initiator ?? "");
      request.input("problem", sql.NVarChar(sql.MAX), project.problem ?? "");
      request.input("goal", sql.NVarChar(sql.MAX), project.goal ?? "");
      request.input("actions", sql.NVarChar(sql.MAX), project.actions ?? "");
      request.input("resources", sql.NVarChar(sql.MAX), project.resources ?? "");
      request.input("cycle", sql.NVarChar(sql.MAX), project.cycle ?? "");
      request.input("benefit", sql.NVarChar(sql.MAX), project.benefit ?? "");
      request.input("approval", sql.NVarChar(sql.MAX), project.approval ?? "");
      request.input("createdAt", sql.NVarChar(32), project.createdAt ?? "");
      request.input("companyId", sql.NVarChar(64), project.companyId ?? "");
      request.input("creatorId", sql.NVarChar(64), project.creatorId ?? "");
      const query = `
        IF EXISTS (SELECT 1 FROM ${config.table} WHERE id = @id)
        BEGIN
          UPDATE ${config.table}
          SET
            name = @name,
            description = @description,
            progress = @progress,
            type = @type,
            departmentId = @departmentId,
            formTemplateId = @formTemplateId,
            formTemplateName = @formTemplateName,
            bomChangeType = @bomChangeType,
            bomTargetId = @bomTargetId,
            bomTargetName = @bomTargetName,
            bomDiffItems = @bomDiffItems,
            bomMaterialAdjustments = @bomMaterialAdjustments,
            bomDiffTraceItems = @bomDiffTraceItems,
            bomRawReplaceTraceItems = @bomRawReplaceTraceItems,
            bomDiffBaseOrder = @bomDiffBaseOrder,
            bomDiffTargetOrder = @bomDiffTargetOrder,
            memberIds = @memberIds,
            memberRoles = @memberRoles,
            initiator = @initiator,
            problem = @problem,
            goal = @goal,
            actions = @actions,
            resources = @resources,
            cycle = @cycle,
            benefit = @benefit,
            approval = @approval,
            createdAt = @createdAt,
            companyId = @companyId,
            creatorId = @creatorId
          WHERE id = @id
        END
        ELSE
        BEGIN
          INSERT INTO ${config.table} (
            id,
            name,
            description,
            progress,
            type,
            departmentId,
            formTemplateId,
            formTemplateName,
            bomChangeType,
            bomTargetId,
            bomTargetName,
            bomDiffItems,
            bomMaterialAdjustments,
            bomDiffTraceItems,
            bomRawReplaceTraceItems,
            bomDiffBaseOrder,
            bomDiffTargetOrder,
            memberIds,
            memberRoles,
            initiator,
            problem,
            goal,
            actions,
            resources,
            cycle,
            benefit,
            approval,
            createdAt,
            companyId,
            creatorId
          )
          VALUES (
            @id,
            @name,
            @description,
            @progress,
            @type,
            @departmentId,
            @formTemplateId,
            @formTemplateName,
            @bomChangeType,
            @bomTargetId,
            @bomTargetName,
            @bomDiffItems,
            @bomMaterialAdjustments,
            @bomDiffTraceItems,
            @bomRawReplaceTraceItems,
            @bomDiffBaseOrder,
            @bomDiffTargetOrder,
            @memberIds,
            @memberRoles,
            @initiator,
            @problem,
            @goal,
            @actions,
            @resources,
            @cycle,
            @benefit,
            @approval,
            @createdAt,
            @companyId,
            @creatorId
          )
        END
      `;
      await request.query(query);

      const items = Array.isArray(project.bomDiffItems) ? project.bomDiffItems : [];
      const baseOrder = Array.isArray(project.bomDiffBaseOrder) ? project.bomDiffBaseOrder : [];
      const targetOrder = Array.isArray(project.bomDiffTargetOrder) ? project.bomDiffTargetOrder : [];
      const visible = items.filter((i) => Number(i.delta || 0) !== 0);
      const baseOnly = visible.filter((i) => Number(i.baseQty || 0) > 0 && Number(i.targetQty || 0) === 0);
      const targetOnly = visible.filter((i) => Number(i.targetQty || 0) > 0 && Number(i.baseQty || 0) === 0);
      const changed = visible.filter((i) => Number(i.baseQty || 0) > 0 && Number(i.targetQty || 0) > 0);
      const orderBy = (group: BomDiffItem[], orderKeys: string[]) => {
        const map = new Map(group.map((i) => [getDiffOrderKey(i), i]));
        const seen = new Set<string>();
        const ordered: BomDiffItem[] = [];
        orderKeys.forEach((key) => {
          const item = map.get(key);
          if (!item || seen.has(key)) return;
          ordered.push(item);
          seen.add(key);
        });
        group.forEach((item) => {
          const key = getDiffOrderKey(item);
          if (seen.has(key)) return;
          ordered.push(item);
          seen.add(key);
        });
        return ordered;
      };
      const orderedBase = orderBy(baseOnly, baseOrder);
      const orderedTarget = orderBy(targetOnly, targetOrder);
      const itemsTable = normalizeSqlTableName("XMProjectDiffItems");
      await pool
        .request()
        .input("projectId", sql.NVarChar(64), project.id)
        .query(`DELETE FROM ${itemsTable} WHERE projectId = @projectId`);
      let seq = 1;
      const insertOne = async (groupType: string, item: BomDiffItem, seqValue: number) => {
        const req = pool.request();
        req.input("projectId", sql.NVarChar(64), project.id);
        req.input("seq", sql.Int, seqValue);
        req.input("groupType", sql.NVarChar(16), groupType);
        req.input("materialCode", sql.NVarChar(256), item.materialCode || null);
        req.input("materialName", sql.NVarChar(512), item.materialName || null);
        req.input("baseQty", sql.Float, Number(item.baseQty) || 0);
        req.input("targetQty", sql.Float, Number(item.targetQty) || 0);
        req.input("delta", sql.Float, Number(item.delta) || 0);
        req.input("itemId", sql.NVarChar(128), item.itemId || null);
        await req.query(
          `INSERT INTO ${itemsTable}
           (projectId, seq, groupType, materialCode, materialName, baseQty, targetQty, delta, itemId)
           VALUES (@projectId, @seq, @groupType, @materialCode, @materialName, @baseQty, @targetQty, @delta, @itemId)`
        );
      };
      for (const item of orderedBase) {
        await insertOne("baseOnly", item, seq++);
      }
      seq = 1;
      for (const item of orderedTarget) {
        await insertOne("targetOnly", item, seq++);
      }
      seq = 1;
      for (const item of changed) {
        await insertOne("changed", item, seq++);
      }

      const traceTable = normalizeSqlTableName("XMProjectDiffTraceItems");
      await pool
        .request()
        .input("projectId", sql.NVarChar(64), project.id)
        .query(`DELETE FROM ${traceTable} WHERE projectId = @projectId`);
      const diffItems = Array.isArray(project.bomDiffItems) ? project.bomDiffItems : [];
      const traceGroups = Array.isArray(project.bomDiffTraceItems) ? project.bomDiffTraceItems : [];
      for (let diffIndex = 0; diffIndex < traceGroups.length; diffIndex += 1) {
        const group = Array.isArray(traceGroups[diffIndex]) ? traceGroups[diffIndex] : [];
        if (group.length === 0) continue;
        const diffItem = diffItems[diffIndex];
        for (const traceItem of group) {
          const req = pool.request();
          req.input("projectId", sql.NVarChar(64), project.id);
          req.input("diffIndex", sql.Int, diffIndex);
          req.input("itemId", sql.NVarChar(128), diffItem?.itemId || null);
          req.input("materialCode", sql.NVarChar(256), diffItem?.materialCode || null);
          req.input("materialName", sql.NVarChar(512), diffItem?.materialName || null);
          req.input("bomNumber", sql.NVarChar(128), traceItem?.bomNumber || "");
          req.input("bomCode", sql.NVarChar(128), traceItem?.bomCode || null);
          req.input("bomName", sql.NVarChar(256), traceItem?.bomName || null);
          req.input("auxQty", sql.Float, Number(traceItem?.auxQty) || 0);
          req.input("audDate", sql.NVarChar(64), traceItem?.audDate || null);
          await req.query(
            `INSERT INTO ${traceTable}
             (projectId, diffIndex, itemId, materialCode, materialName, bomNumber, bomCode, bomName, auxQty, audDate)
             VALUES (@projectId, @diffIndex, @itemId, @materialCode, @materialName, @bomNumber, @bomCode, @bomName, @auxQty, @audDate)`
          );
        }
      }
    });
  } catch {}
}

export async function deleteProjectFromSql(projectId: string) {
  const config = getProjectSqlConfig();
  if (!config) return;
  try {
    await withProjectSqlPool(config.connectionString, async (pool) => {
      await ensureProjectSqlTable(pool, config.table);
      await ensureProjectDiffItemsTable(pool);
      const itemsTable = normalizeSqlTableName("XMProjectDiffItems");
      const traceTable = normalizeSqlTableName("XMProjectDiffTraceItems");
      await pool
        .request()
        .input("projectId", sql.NVarChar(64), projectId)
        .query(`DELETE FROM ${itemsTable} WHERE projectId = @projectId`);
      await pool
        .request()
        .input("projectId", sql.NVarChar(64), projectId)
        .query(`DELETE FROM ${traceTable} WHERE projectId = @projectId`);
      await pool.request().input("id", sql.NVarChar(64), projectId).query(
        `DELETE FROM ${config.table} WHERE id = @id`
      );
    });
  } catch {}
}

export async function getVisibleProjectsFromSql(user: User) {
  const config = getProjectSqlConfig();
  if (!config) return null;
  try {
    return await withProjectSqlPool(config.connectionString, async (pool) => {
      const customQuery = getProjectSqlQuery().trim();
      if (!customQuery) {
        await ensureProjectSqlTable(pool, config.table);
      }
      const columns = customQuery ? { company: false, department: false } : await getProjectVisibilityColumns(pool, config.table);
      const where = customQuery ? "" : buildProjectVisibilityWhere(columns);
      const request = pool.request();
      request.input("companyId", sql.NVarChar(64), user.companyId || "");
      request.input("departmentId", sql.NVarChar(64), user.departmentId || "");
      request.input("isAdmin", sql.Bit, user.role === "admin");
      const result = await request.query(customQuery || `SELECT * FROM ${config.table} ${where}`);
      const rows = Array.isArray(result.recordset) ? result.recordset : [];
      const projects = rows.map((row) => toProjectFromSqlRow(row)).filter((item): item is Project => Boolean(item));
      return await Promise.all(projects.map((project) => applyOutstockBenefit(project)));
    });
  } catch {
    return null;
  }
}

export async function getVisibleProjectSummariesFromSql(user: User) {
  const config = getProjectSqlConfig();
  if (!config) return null;
  try {
    return await withProjectSqlPool(config.connectionString, async (pool) => {
      const customQuery = getProjectSqlQuery().trim();
      if (!customQuery) {
        await ensureProjectSqlTable(pool, config.table);
      }
      const columns = customQuery ? { company: false, department: false } : await getProjectVisibilityColumns(pool, config.table);
      const where = customQuery ? "" : buildProjectVisibilityWhere(columns);
      const request = pool.request();
      request.input("companyId", sql.NVarChar(64), user.companyId || "");
      request.input("departmentId", sql.NVarChar(64), user.departmentId || "");
      request.input("isAdmin", sql.Bit, user.role === "admin");
      const result = await request.query(customQuery || `SELECT * FROM ${config.table} ${where}`);
      const rows = Array.isArray(result.recordset) ? result.recordset : [];
      const projects = rows
        .map((row) => toProjectSummaryFromSqlRow(row))
        .filter((item): item is ProjectSummaryItem => Boolean(item));
      return await Promise.all(projects.map((project) => applyOutstockBenefit(project)));
    });
  } catch {
    return null;
  }
}

export async function getProjectByIdFromSql(user: User, projectId: string) {
  const config = getProjectSqlConfig();
  if (!config) return null;
  try {
    return await withProjectSqlPool(config.connectionString, async (pool) => {
      const customQuery = getProjectSqlQuery().trim();
      if (!customQuery) {
        await ensureProjectSqlTable(pool, config.table);
      }
      await ensureProjectDiffItemsTable(pool);
      const idColumn = customQuery ? null : await resolveProjectIdColumn(pool, config.table);
      if (!customQuery && !idColumn) return null;
      const columns = customQuery ? { company: false, department: false } : await getProjectVisibilityColumns(pool, config.table);
      const request = pool.request();
      request.input("id", sql.NVarChar(64), projectId);
      request.input("companyId", sql.NVarChar(64), user.companyId || "");
      request.input("departmentId", sql.NVarChar(64), user.departmentId || "");
      request.input("isAdmin", sql.Bit, user.role === "admin");
      const result = await request.query(
        customQuery
          ? customQuery
          : `SELECT TOP 1 * FROM ${config.table}
             WHERE ${idColumn} = @id
             ${
               columns.company
                 ? "AND (@companyId = '' OR companyId = @companyId OR companyId IS NULL OR companyId = '')"
                 : ""
             }
             ${
               columns.department
                 ? "AND (@isAdmin = 1 OR @departmentId = '' OR departmentId = @departmentId OR departmentId IS NULL OR departmentId = '')"
                 : ""
             }`
      );
      const rows = Array.isArray(result.recordset) ? result.recordset : [];
      let baseProject = customQuery
        ? rows.map((row) => toProjectFromSqlRow(row)).find((project) => project?.id === projectId) ?? null
        : rows[0]
          ? toProjectFromSqlRow(rows[0])
          : null;
      if (!baseProject) return null;
      if (customQuery) {
        await ensureProjectSqlTable(pool, config.table);
        const fallbackIdColumn = await resolveProjectIdColumn(pool, config.table);
        if (fallbackIdColumn) {
          const fallbackColumns = await getProjectVisibilityColumns(pool, config.table);
          const fallbackResult = await pool
            .request()
            .input("id", sql.NVarChar(64), projectId)
            .input("companyId", sql.NVarChar(64), user.companyId || "")
            .input("departmentId", sql.NVarChar(64), user.departmentId || "")
            .input("isAdmin", sql.Bit, user.role === "admin")
            .query(
              `SELECT TOP 1 * FROM ${config.table}
               WHERE ${fallbackIdColumn} = @id
               ${
                 fallbackColumns.company
                   ? "AND (@companyId = '' OR companyId = @companyId OR companyId IS NULL OR companyId = '')"
                   : ""
               }
               ${
                 fallbackColumns.department
                   ? "AND (@isAdmin = 1 OR @departmentId = '' OR departmentId = @departmentId OR departmentId IS NULL OR departmentId = '')"
                   : ""
               }`
            );
          const fallbackRow = Array.isArray(fallbackResult.recordset) ? fallbackResult.recordset[0] : null;
          let fallbackProject = fallbackRow ? toProjectFromSqlRow(fallbackRow) : null;
          if (!fallbackProject && baseProject.name) {
            const nameResult = await pool
              .request()
              .input("name", sql.NVarChar(200), baseProject.name)
              .input("companyId", sql.NVarChar(64), user.companyId || "")
              .input("departmentId", sql.NVarChar(64), user.departmentId || "")
              .input("isAdmin", sql.Bit, user.role === "admin")
              .query(
                `SELECT TOP 1 * FROM ${config.table}
                 WHERE name = @name
                 ${
                   fallbackColumns.company
                     ? "AND (@companyId = '' OR companyId = @companyId OR companyId IS NULL OR companyId = '')"
                     : ""
                 }
                 ${
                   fallbackColumns.department
                     ? "AND (@isAdmin = 1 OR @departmentId = '' OR departmentId = @departmentId OR departmentId IS NULL OR departmentId = '')"
                     : ""
                 }`
              );
            const nameRow = Array.isArray(nameResult.recordset) ? nameResult.recordset[0] : null;
            fallbackProject = nameRow ? toProjectFromSqlRow(nameRow) : null;
          }
          if (fallbackProject) {
            baseProject = mergeProjectWithFallback(baseProject, fallbackProject);
          }
        }
      }
      baseProject = await applyOutstockBenefit(baseProject);
      const itemsTable = normalizeSqlTableName("XMProjectDiffItems");
      const itemsResult = await pool
        .request()
        .input("projectId", sql.NVarChar(64), projectId)
        .query(
          `SELECT seq, groupType, materialCode, materialName, baseQty, targetQty, delta, itemId
           FROM ${itemsTable}
           WHERE projectId = @projectId
           ORDER BY groupType ASC, seq ASC`
        );
      const diffRows = Array.isArray(itemsResult.recordset) ? itemsResult.recordset : [];
      if (diffRows.length === 0) return baseProject;
      const normalizeQty = (value: unknown) => {
        const num = typeof value === "number" ? value : Number(readSqlString(value));
        return Number.isFinite(num) ? num : 0;
      };
      const makeItem = (r: Record<string, unknown>): BomDiffItem => ({
        materialCode: readSqlString(r.materialCode),
        materialName: readSqlString(r.materialName),
        baseQty: normalizeQty(r.baseQty),
        targetQty: normalizeQty(r.targetQty),
        delta: normalizeQty(r.delta),
        itemId: readSqlOptionalString(r.itemId),
      });
      const diffItems: BomDiffItem[] = diffRows.map((r) => makeItem(r));
      const baseOnlyOrder: string[] = [];
      const targetOnlyOrder: string[] = [];
      for (const r of diffRows) {
        const item = makeItem(r);
        const key = getDiffOrderKey(item);
        const groupType = readSqlString(r.groupType);
        if (groupType === "baseOnly") baseOnlyOrder.push(key);
        else if (groupType === "targetOnly") targetOnlyOrder.push(key);
      }
      return {
        ...baseProject,
        bomDiffItems: diffItems,
        bomDiffBaseOrder: baseOnlyOrder,
        bomDiffTargetOrder: targetOnlyOrder,
      };
    });
  } catch {
    return null;
  }
}

export async function getUserByUsernameAndPassword(username: string, password: string) {
  syncFromDisk();
  const user = userStore.find((u) => u.username === username);
  if (!user) return null;
  
  const { verifyPassword, isHashedPassword } = await import("./password");
  
  if (isHashedPassword(user.password)) {
    const isValid = await verifyPassword(password, user.password);
    return isValid ? user : null;
  }
  
  return user.password === password ? user : null;
}

export function getUserById(userId: string) {
  syncFromDisk();
  return userStore.find((u) => u.id === userId);
}

export function getAllUsers() {
  syncFromDisk();
  return userStore;
}

export function getAppSettings() {
  syncFromDisk();
  return appSettingsStore;
}

export function updateAppSettings(patch: Partial<AppSettings>) {
  syncFromDisk();

  const sourceValues: FormsDataSource[] = ["sqlserver", "upstream", "local"];
  const nextSource = patch.forms?.source ?? appSettingsStore.forms.source;
  if (!sourceValues.includes(nextSource)) return null;

  const themeValues: ThemeOption[] = ["graphite", "ocean", "amber"];
  const nextTheme = patch.theme ?? appSettingsStore.theme;
  if (!themeValues.includes(nextTheme)) return null;

  const nextSqlServer =
    patch.forms && "sqlServer" in patch.forms ? patch.forms.sqlServer : appSettingsStore.forms.sqlServer;
  const nextUpstream =
    patch.forms && "upstream" in patch.forms ? patch.forms.upstream : appSettingsStore.forms.upstream;

  const next: AppSettings = {
    ...appSettingsStore,
    ...patch,
    theme: nextTheme,
    forms: {
      ...appSettingsStore.forms,
      ...patch.forms,
      source: nextSource,
      sqlServer: nextSqlServer || undefined,
      upstream: nextUpstream || undefined,
    },
  };

  if (next.forms.sqlServer) {
    const limit = next.forms.sqlServer.limit;
    if (limit !== undefined) {
      const parsedLimit = Math.min(Math.max(Number(limit) || 0, 1), 200);
      next.forms.sqlServer = { ...next.forms.sqlServer, limit: parsedLimit };
    }
  }

  appSettingsStore = next;
  persistToDisk();
  return next;
}

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
      if (!map.has(code)) {
        map.set(code, []);
        order.push(code);
      }
      map.get(code)?.push(item);
    });
    return { map, order };
  };
  const baseGrouped = groupByCode(baseItems);
  const latestGrouped = groupByCode(latestItems);
  const codes: string[] = [];
  const seenCodes = new Set<string>();
  latestGrouped.order.forEach((code) => {
    if (seenCodes.has(code)) return;
    seenCodes.add(code);
    codes.push(code);
  });
  baseGrouped.order.forEach((code) => {
    if (seenCodes.has(code)) return;
    seenCodes.add(code);
    codes.push(code);
  });
  const diffs: PricingDiff[] = [];
  codes.forEach((code) => {
    const baseList = baseGrouped.map.get(code) || [];
    const latestList = latestGrouped.map.get(code) || [];
    const maxCount = Math.max(baseList.length, latestList.length);
    for (let i = 0; i < maxCount; i += 1) {
      const base = baseList[i];
      const latest = latestList[i];
      const baseAmount = readItemAmount(base);
      const latestAmount = readItemAmount(latest);
      const deltaAmount = (latestAmount ?? 0) - (baseAmount ?? 0);
      let status: PricingDiff["status"] = "unchanged";
      if (!base) status = "added";
      else if (!latest) status = "removed";
      else if (Math.abs(deltaAmount) > 0.0001) status = "changed";
      diffs.push({
        materialCode: code,
        materialName: latest?.materialName || base?.materialName || "",
        baseAmount,
        latestAmount,
        deltaAmount,
        basePrice: baseAmount,
        latestPrice: latestAmount,
        delta: deltaAmount,
        status,
        fields: latest?.fields || base?.fields || {},
        baseFields: base?.fields || {},
      });
    }
  });
  return diffs;
};

export function getPricingSheets() {
  syncFromDisk();
  pricingSheetStore = pricingSheetStore.map((sheet) => {
    const baseVersion = sheet.versions.find((version) => version.id === sheet.baseVersionId) || sheet.versions[0];
    const latestVersion = sheet.versions.find((version) => version.id === sheet.latestVersionId) || sheet.versions.at(-1);
    const diffs =
      baseVersion && latestVersion
        ? toPricingDiffs(baseVersion.items || [], latestVersion.items || [])
        : sheet.diffs || [];
    return {
      ...sheet,
      diffs,
      mainColumns: latestVersion?.mainColumns || sheet.mainColumns || [],
      mainFields: latestVersion?.mainFields || sheet.mainFields || {},
      diffColumns: latestVersion?.columns || sheet.diffColumns || [],
    };
  });
  persistToDisk();
  return pricingSheetStore;
}

export function addPricingSheetVersion(params: {
  key: string;
  name?: string;
  projectId?: string;
  fileHash: string;
  fileName: string;
  uploadedBy: string;
  mainColumns?: PricingColumn[];
  mainFields?: Record<string, string>;
  columns?: PricingColumn[];
  items: PricingItem[];
}) {
  syncFromDisk();
  const key = params.key.trim();
  if (!key) return { status: "invalid" as const };
  const now = new Date().toISOString();
  let sheet = pricingSheetStore.find((item) =>
    item.key === key && (item.projectId || "") === (params.projectId || "")
  );
  if (!sheet) {
    const sheetId = createId("ps");
    const versionId = createId("pv");
    const version: PricingVersion = {
      id: versionId,
      sheetId,
      versionNo: 1,
      fileHash: params.fileHash,
      fileName: params.fileName,
      uploadedBy: params.uploadedBy,
      uploadedAt: now,
      mainColumns: params.mainColumns || [],
      mainFields: params.mainFields || {},
      columns: params.columns || [],
      items: params.items,
    };
    const diffs = toPricingDiffs(params.items, params.items);
    sheet = {
      id: sheetId,
      key,
      name: params.name?.trim() || key,
      projectId: params.projectId,
      baseVersionId: versionId,
      latestVersionId: versionId,
      versions: [version],
      diffs,
      mainColumns: version.mainColumns || [],
      mainFields: version.mainFields || {},
      diffColumns: version.columns || [],
      createdAt: now,
      updatedAt: now,
    };
    pricingSheetStore = [sheet, ...pricingSheetStore];
    persistToDisk();
    return { status: "created" as const, sheet };
  }
  const existing = sheet.versions.find((version) => version.fileHash === params.fileHash);
  if (existing) {
    return { status: "duplicate" as const, sheet };
  }
  const nextVersionNo = Math.max(...sheet.versions.map((v) => v.versionNo)) + 1;
  const version: PricingVersion = {
    id: createId("pv"),
    sheetId: sheet.id,
    versionNo: nextVersionNo,
    fileHash: params.fileHash,
    fileName: params.fileName,
    uploadedBy: params.uploadedBy,
    uploadedAt: now,
    mainColumns: params.mainColumns || [],
    mainFields: params.mainFields || {},
    columns: params.columns || [],
    items: params.items,
  };
  const baseVersion = sheet.versions.find((v) => v.id === sheet.baseVersionId) || sheet.versions[0];
  const diffs = toPricingDiffs(baseVersion?.items || [], version.items);
  const updated: PricingSheet = {
    ...sheet,
    name: params.name?.trim() || sheet.name,
    latestVersionId: version.id,
    versions: [...sheet.versions, version],
    diffs,
    mainColumns: version.mainColumns || sheet.mainColumns || [],
    mainFields: version.mainFields || sheet.mainFields || {},
    diffColumns: version.columns || sheet.diffColumns || [],
    updatedAt: now,
  };
  pricingSheetStore = pricingSheetStore.map((item) => (item.id === sheet.id ? updated : item));
  persistToDisk();
  return { status: "updated" as const, sheet: updated };
}

// --- SQL/JSON routing wrappers ---

export async function getPricingSheetList(
  departmentId?: string,
  query?: string,
  projectId?: string
): Promise<PricingSheetSummary[]> {
  if (hasPricingSqlConfig()) {
    return getPricingSheetListFromSql(departmentId, query, projectId);
  }
  syncFromDisk();
  let filtered = pricingSheetStore;
  if (projectId) {
    filtered = filtered.filter((s) => s.projectId === projectId);
  }
  if (departmentId) {
    filtered = filtered.filter((s) => !s.departmentId || s.departmentId === departmentId);
  }
  if (query) {
    const q = query.toLowerCase();
    filtered = filtered.filter((s) =>
      s.key.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)
    );
  }
  return filtered.map((s) => ({
    id: s.id,
    key: s.key,
    name: s.name,
    projectId: s.projectId,
    versionCount: s.versions.length,
    latestVersionNo: Math.max(...s.versions.map((v) => v.versionNo), 0),
    updatedAt: s.updatedAt,
    createdAt: s.createdAt,
    createdBy: s.createdBy,
    departmentId: s.departmentId,
  }));
}

export async function getPricingSheetById(sheetId: string): Promise<PricingSheet | null> {
  if (hasPricingSqlConfig()) {
    return getPricingSheetByIdFromSql(sheetId);
  }
  syncFromDisk();
  const sheet = pricingSheetStore.find((s) => s.id === sheetId);
  if (!sheet) return null;
  const baseVersion = sheet.versions.find((v) => v.id === sheet.baseVersionId) || sheet.versions[0];
  const latestVersion = sheet.versions.find((v) => v.id === sheet.latestVersionId) || sheet.versions.at(-1);
  const diffs = baseVersion && latestVersion
    ? toPricingDiffs(baseVersion.items || [], latestVersion.items || [])
    : sheet.diffs || [];
  return {
    ...sheet,
    diffs,
    mainColumns: latestVersion?.mainColumns || sheet.mainColumns || [],
    mainFields: latestVersion?.mainFields || sheet.mainFields || {},
    diffColumns: latestVersion?.columns || sheet.diffColumns || [],
  };
}

export async function addPricingVersion(params: {
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
}) {
  if (hasPricingSqlConfig()) {
    return addPricingSheetVersionToSql(params);
  }
  return addPricingSheetVersion({
    ...params,
  });
}

export async function addPricingLog(params: {
  sheetId?: string;
  sheetKey?: string;
  action: string;
  detail?: string;
  userId: string;
  userName: string;
}) {
  if (hasPricingSqlConfig()) {
    return addPricingLogToSql(params);
  }
  // JSON mode: no-op for logs (logs only available with SQL)
}

export async function getPricingLogs(sheetId?: string, limit?: number): Promise<PricingLog[]> {
  if (hasPricingSqlConfig()) {
    return getPricingLogsFromSql(sheetId, limit);
  }
  return [];
}

export async function searchPricingSheetList(
  query: string,
  departmentId?: string
): Promise<PricingSheetSummary[]> {
  if (hasPricingSqlConfig()) {
    return searchPricingSheetsFromSql(query, departmentId);
  }
  return getPricingSheetList(departmentId, query);
}

export async function getPricingStats() {
  if (hasPricingSqlConfig()) {
    return getPricingStatsFromSql();
  }
  syncFromDisk();
  return {
    totalSheets: pricingSheetStore.length,
    totalVersions: pricingSheetStore.reduce((sum, s) => sum + s.versions.length, 0),
    recentUpdates: pricingSheetStore.filter((s) => {
      const d = new Date(s.updatedAt);
      return Date.now() - d.getTime() < 7 * 24 * 60 * 60 * 1000;
    }).length,
  };
}

export function getFormTemplateById(id: string) {
  syncFromDisk();
  return formTemplateStore.find((f) => f.id === id) || null;
}

export function getFormTemplates(user: User, query?: string) {
  syncFromDisk();
  const q = (query || "").trim().toLowerCase();
  return formTemplateStore
    .filter((f) => f.companyId === user.companyId)
    .filter((f) => {
      if (!q) return true;
      return (
        f.name.toLowerCase().includes(q) ||
        f.code.toLowerCase().includes(q) ||
        (f.version || "").toLowerCase().includes(q)
      );
    });
}

export function updateUser(
  userId: string,
  patch: Partial<Pick<User, "role" | "departmentId" | "name" | "username" | "avatar">>
) {
  syncFromDisk();
  const existing = userStore.find((u) => u.id === userId);
  if (!existing) return null;
  const next: User = { ...existing, ...patch };
  userStore = userStore.map((u) => (u.id === userId ? next : u));
  persistToDisk();
  return next;
}

export function createUser(
  data: Pick<User, "name" | "username" | "role" | "companyId" | "password"> &
    Partial<Pick<User, "departmentId" | "avatar">>
) {
  syncFromDisk();
  const username = data.username.trim();
  if (!username) return null;
  if (userStore.some((u) => u.username === username)) return null;

  const id = `u${Math.random().toString(36).slice(2, 9)}`;
  const user: User = {
    id,
    name: data.name.trim(),
    username,
    role: data.role,
    companyId: data.companyId,
    password: data.password,
    departmentId: data.role === "admin" ? undefined : data.departmentId,
    avatar: data.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(username)}`,
  };
  userStore = [user, ...userStore];
  persistToDisk();
  return user;
}

export function getVisibleProjects(user: User) {
  syncFromDisk();
  return projectStore.filter((project) => {
    if (user.role === "admin") return true;
    return project.departmentId === user.departmentId;
  });
}

export function getVisibleProjectSummaries(user: User): ProjectSummaryItem[] {
  syncFromDisk();
  return projectStore
    .filter((project) => {
      if (user.role === "admin") return true;
      return project.departmentId === user.departmentId;
    })
    .map((project) => ({
      id: project.id,
      name: project.name,
      description: project.description,
      progress: project.progress,
      type: project.type,
      departmentId: project.departmentId,
      bomChangeType: project.bomChangeType,
      initiator: project.initiator,
      goal: project.goal,
      cycle: project.cycle,
      benefit: project.benefit,
      createdAt: project.createdAt,
      companyId: project.companyId,
      creatorId: project.creatorId,
    }));
}

export function getAllProjects() {
  syncFromDisk();
  return projectStore;
}

export function getProjectById(projectId: string) {
  syncFromDisk();
  return projectStore.find((p) => p.id === projectId);
}

export function updateProjectMembers(projectId: string, memberIds: string[]) {
  syncFromDisk();
  const project = projectStore.find((p) => p.id === projectId);
  if (!project) return null;
  const unique = Array.from(new Set(memberIds)).filter((id) => Boolean(getUserById(id)));
  const memberRoles: Record<string, ProjectMemberRole> = { ...(project.memberRoles || {}) };
  for (const id of unique) {
    if (!memberRoles[id]) memberRoles[id] = "member";
  }
  for (const id of Object.keys(memberRoles)) {
    if (!unique.includes(id)) delete memberRoles[id];
  }
  if (project.creatorId) {
    memberRoles[project.creatorId] = "owner";
    if (!unique.includes(project.creatorId)) unique.push(project.creatorId);
  }
  const next: Project = { ...project, memberIds: unique, memberRoles };
  projectStore = projectStore.map((p) => (p.id === projectId ? next : p));
  persistToDisk();
  return next;
}

export function updateProjectMemberRoles(
  projectId: string,
  memberRoles: Record<string, ProjectMemberRole>
) {
  syncFromDisk();
  const project = projectStore.find((p) => p.id === projectId);
  if (!project) return null;
  const validUserIds = new Set(userStore.map((u) => u.id));
  const nextRoles: Record<string, ProjectMemberRole> = {};
  for (const [userId, role] of Object.entries(memberRoles)) {
    if (!validUserIds.has(userId)) continue;
    if (role === "owner" || role === "pm" || role === "member" || role === "viewer") {
      nextRoles[userId] = role;
    }
  }
  if (project.creatorId && validUserIds.has(project.creatorId)) {
    nextRoles[project.creatorId] = "owner";
  }
  const nextMemberIds = Array.from(new Set(Object.keys(nextRoles)));
  const next: Project = { ...project, memberIds: nextMemberIds, memberRoles: nextRoles };
  projectStore = projectStore.map((p) => (p.id === projectId ? next : p));
  persistToDisk();
  return next;
}

export function getProjectTasks(projectId: string) {
  syncFromDisk();
  return taskStore.filter((t) => t.projectId === projectId);
}

export function getTaskById(taskId: string) {
  syncFromDisk();
  return taskStore.find((t) => t.id === taskId);
}

export function getTaskCountByProject(projectId: string) {
  syncFromDisk();
  return taskStore.filter((t) => t.projectId === projectId).length;
}

export function getCompletedTaskCountByProject(projectId: string) {
  syncFromDisk();
  return taskStore.filter((t) => t.projectId === projectId && t.completed).length;
}
export function createProject(
  user: User,
  data: Pick<
    Project,
    | "name"
    | "description"
    | "formTemplateId"
    | "formTemplateName"
    | "bomChangeType"
    | "bomTargetId"
    | "bomTargetName"
    | "bomDiffItems"
    | "bomMaterialAdjustments"
    | "bomDiffBaseOrder"
    | "bomDiffTargetOrder"
    | "initiator"
    | "problem"
    | "goal"
    | "actions"
    | "resources"
    | "cycle"
    | "benefit"
    | "approval"
    | "type"
    | "departmentId"
  >
) {
  syncFromDisk();
  const project: Project = {
    ...data,
    id: Math.random().toString(36).slice(2, 9),
    progress: 0,
    createdAt: new Date().toISOString().split("T")[0],
    companyId: user.companyId,
    creatorId: user.id,
    memberIds: [user.id],
    memberRoles: { [user.id]: "owner" },
    departmentId: data.type === "department" ? data.departmentId || user.departmentId : undefined,
  };
  projectStore = [project, ...projectStore];
  persistToDisk();
  return project;
}

export function deleteProject(projectId: string) {
  syncFromDisk();
  projectStore = projectStore.filter((p) => p.id !== projectId);
  taskStore = taskStore.filter((t) => t.projectId !== projectId);
  persistToDisk();
}

export function addTask(projectId: string, title: string, assignee?: string) {
  syncFromDisk();
  const task: Task = {
    id: Math.random().toString(36).slice(2, 9),
    projectId,
    title,
    completed: false,
    assignee,
  };
  taskStore = [task, ...taskStore];
  persistToDisk();
  return task;
}

export function toggleTask(taskId: string) {
  syncFromDisk();
  taskStore = taskStore.map((t) =>
    t.id === taskId ? { ...t, completed: !t.completed } : t
  );
  persistToDisk();
  return taskStore.find((t) => t.id === taskId);
}

export function deleteTask(taskId: string) {
  syncFromDisk();
  taskStore = taskStore.filter((t) => t.id !== taskId);
  persistToDisk();
}

export function updateProject(
  projectId: string,
  patch: Partial<
    Pick<
      Project,
      | "name"
      | "initiator"
      | "problem"
      | "goal"
      | "actions"
      | "resources"
      | "cycle"
      | "benefit"
      | "approval"
      | "formTemplateId"
      | "formTemplateName"
      | "bomChangeType"
      | "bomTargetId"
      | "bomTargetName"
      | "bomDiffItems"
      | "bomMaterialAdjustments"
      | "bomDiffTraceItems"
      | "bomRawReplaceTraceItems"
      | "bomDiffBaseOrder"
      | "bomDiffTargetOrder"
    >
  >
) {
  syncFromDisk();
  const existing = projectStore.find((p) => p.id === projectId);
  if (!existing) return null;
  const next: Project = {
    ...existing,
    name: typeof patch.name === "string" ? patch.name : existing.name,
    initiator: typeof patch.initiator === "string" ? patch.initiator : existing.initiator,
    problem: typeof patch.problem === "string" ? patch.problem : existing.problem,
    goal: typeof patch.goal === "string" ? patch.goal : existing.goal,
    actions: typeof patch.actions === "string" ? patch.actions : existing.actions,
    resources: typeof patch.resources === "string" ? patch.resources : existing.resources,
    cycle: typeof patch.cycle === "string" ? patch.cycle : existing.cycle,
    benefit: typeof patch.benefit === "string" ? patch.benefit : existing.benefit,
    approval: typeof patch.approval === "string" ? patch.approval : existing.approval,
    formTemplateId: patch.formTemplateId ?? existing.formTemplateId,
    formTemplateName: patch.formTemplateName ?? existing.formTemplateName,
    bomChangeType: patch.bomChangeType ?? existing.bomChangeType,
    bomTargetId: patch.bomTargetId ?? existing.bomTargetId,
    bomTargetName: patch.bomTargetName ?? existing.bomTargetName,
    bomDiffItems: patch.bomDiffItems ?? existing.bomDiffItems,
    bomMaterialAdjustments: patch.bomMaterialAdjustments ?? existing.bomMaterialAdjustments,
    bomDiffTraceItems: patch.bomDiffTraceItems ?? existing.bomDiffTraceItems,
    bomRawReplaceTraceItems: patch.bomRawReplaceTraceItems ?? existing.bomRawReplaceTraceItems,
    bomDiffBaseOrder: patch.bomDiffBaseOrder ?? existing.bomDiffBaseOrder,
    bomDiffTargetOrder: patch.bomDiffTargetOrder ?? existing.bomDiffTargetOrder,
  };
  projectStore = projectStore.map((p) => (p.id === projectId ? next : p));
  persistToDisk();
  return next;
}
