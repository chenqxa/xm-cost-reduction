export type UserRole = 'admin' | 'manager' | 'employee';
export type ProjectType = 'company' | 'department';
export type ProjectMemberRole = 'owner' | 'pm' | 'member' | 'viewer';
export type FormsDataSource = 'sqlserver' | 'upstream' | 'local';
export type ThemeOption = 'graphite' | 'ocean' | 'amber';
export type BomChangeType = 'replace' | 'materialAdjust' | 'rawMaterialReplace';

export interface FormsSqlServerSettings {
  connectionString: string;
  table: string;
  limit?: number;
}

export interface FormsUpstreamSettings {
  url: string;
  apiKey?: string;
}

export interface FormsSettings {
  source: FormsDataSource;
  sqlServer?: FormsSqlServerSettings;
  upstream?: FormsUpstreamSettings;
}

export interface AppSettings {
  theme: ThemeOption;
  forms: FormsSettings;
}

export interface FormTemplate {
  id: string;
  name: string;
  code: string;
  version?: string;
  companyId: string;
  createdAt: string;
}

export interface Department {
  id: string;
  name: string;
  managerId: string;
}

export interface User {
  id: string;
  name: string;
  username: string;
  avatar: string;
  role: UserRole;
  departmentId?: string;
  position?: string;
  companyId: string;
  email?: string;
  password: string;
}

export interface Company {
  id: string;
  name: string;
  logo: string;
}

export interface BomDiffItem {
  materialCode: string;
  materialName: string;
  baseQty: number;
  targetQty: number;
  delta: number;
  itemId?: string;
}

export interface BomTraceItem {
  bomNumber: string;
  bomCode: string;
  bomName: string;
  auxQty: number;
  audDate: string;
}

export interface BomMaterialAdjustment {
  materialCode: string;
  materialName: string;
  oldPrice: number;
  newPrice: number;
  delta: number;
  replaceFromCode?: string;
  replaceFromName?: string;
  replaceToCode?: string;
  replaceToName?: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  progress: number;
  type: ProjectType;
  departmentId?: string;
  formTemplateId?: string;
  formTemplateName?: string;
  bomChangeType?: BomChangeType;
  bomTargetId?: string;
  bomTargetName?: string;
  bomDiffItems?: BomDiffItem[];
  bomMaterialAdjustments?: BomMaterialAdjustment[];
  bomDiffTraceItems?: BomTraceItem[][];
  bomRawReplaceTraceItems?: BomTraceItem[][];
  bomDiffBaseOrder?: string[];
  bomDiffTargetOrder?: string[];
  memberIds: string[];
  memberRoles?: Record<string, ProjectMemberRole>;
  initiator: string;
  problem: string;
  goal: string;
  actions: string;
  resources: string;
  cycle: string;
  salesOrderNo?: string;
  benefit: string;
  approval: string;
  createdAt: string;
  companyId: string;
  creatorId: string;
}

export interface Task {
  id: string;
  projectId: string;
  title: string;
  completed: boolean;
  assignee?: string;
  dueDate?: string;
}

export interface PricingItem {
  materialCode: string;
  materialName: string;
  amount: number;
  price?: number;
  fields?: Record<string, string>;
}

export interface PricingColumn {
  key: string;
  label: string;
}

export interface PricingVersion {
  id: string;
  sheetId: string;
  versionNo: number;
  fileHash: string;
  fileName: string;
  uploadedBy: string;
  uploadedByName?: string;
  uploadedAt: string;
  mainColumns?: PricingColumn[];
  mainFields?: Record<string, string>;
  columns?: PricingColumn[];
  items: PricingItem[];
}

export interface PricingDiff {
  materialCode: string;
  materialName: string;
  baseAmount: number | null;
  latestAmount: number | null;
  deltaAmount: number;
  basePrice: number | null;
  latestPrice: number | null;
  delta: number;
  status: "added" | "removed" | "changed" | "unchanged";
  fields?: Record<string, string>;
  baseFields?: Record<string, string>;
}

export interface PricingSheet {
  id: string;
  key: string;
  name: string;
  projectId?: string;
  baseVersionId: string;
  latestVersionId: string;
  versions: PricingVersion[];
  diffs: PricingDiff[];
  mainColumns?: PricingColumn[];
  mainFields?: Record<string, string>;
  diffColumns?: PricingColumn[];
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  departmentId?: string;
}

export interface PricingSheetSummary {
  id: string;
  key: string;
  name: string;
  projectId?: string;
  versionCount: number;
  latestVersionNo: number;
  updatedAt: string;
  createdAt: string;
  createdBy?: string;
  departmentId?: string;
}

export interface PricingLog {
  id: number;
  sheetId: string;
  sheetKey: string;
  action: string;
  detail: string;
  userId: string;
  userName: string;
  createdAt: string;
}
