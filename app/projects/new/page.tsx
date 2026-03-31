"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Home,
  Search,
  X,
  Check,
  Database,
  Loader2,
  ChevronDown,
  ChevronRight,
  GripVertical,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Textarea } from "@/components/ui/Textarea";
import { BomChangeType, BomDiffItem, BomMaterialAdjustment, Project, User } from "@/types";

type BomDiffDraft = {
  id: string;
  materialCode: string;
  materialName: string;
  baseQty: string;
  targetQty: string;
  itemId?: string;
  unitPrice?: number;
};

type BomMaterialDraft = {
  id: string;
  materialCode: string;
  materialName: string;
  oldPrice: string;
  newPrice: string;
  replaceFromCode: string;
  replaceFromName: string;
  replaceToCode: string;
  replaceToName: string;
};

type FormState = {
  formTemplateId?: string;
  bomChangeType: BomChangeType;
  bomTargetId?: string;
  bomDiffItems: BomDiffDraft[];
  bomMaterialAdjustments: BomMaterialDraft[];
  bomCode: string;
  bomTargetCode: string;
  initiator?: string;
  problem?: string;
  goal?: string;
  actions?: string;
  resources?: string;
  cycle?: string;
  benefit?: string;
  approval?: string;
};

type FormTemplateSummary = {
  id: string;
  name: string;
  code: string;
  bomNumber?: string;
  version?: string;
  createdAt: string;
};

type BomMaterialItem = {
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

type BomTraceItem = {
  bomNumber: string;
  bomCode: string;
  bomName: string;
  auxQty: number;
  audDate: string;
};

type CostLinkItem = {
  id: string;
  name: string;
  category: string;
  amount: number;
  oaProject: string;
  note: string;
};

const formatMoney = (value: number) =>
  new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 2 }).format(value);

const baseCostLinks: CostLinkItem[] = [
  {
    id: "oa-01",
    name: "材料替换带来单件降本",
    category: "材料成本",
    amount: 0,
    oaProject: "OA-2024-成本优化-032",
    note: "铝改铁，单件成本下降",
  },
  {
    id: "oa-02",
    name: "设备采购",
    category: "设备投入",
    amount: -48000,
    oaProject: "OA-2024-设备采购-015",
    note: "新增冲压设备",
  },
  {
    id: "oa-03",
    name: "模具费用",
    category: "模具投入",
    amount: -28000,
    oaProject: "OA-2024-模具开发-009",
    note: "铁材模具制作",
  },
  {
    id: "oa-04",
    name: "试产与验证",
    category: "试产费用",
    amount: -12000,
    oaProject: "OA-2024-试产验证-021",
    note: "首批试产",
  },
];

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

const normalizeMaterials = (value: unknown): BomMaterialItem[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const entryId = readString(record.entryId || record.FEntryID || record.fentryid);
      const itemId = readString(record.itemId || record.FItemID || record.fitemid);
      const materialCode = readString(
        record.materialCode ||
          record.code ||
          record.material_code ||
          record.FNumber ||
          record.fnumber ||
          record.itemCode ||
          record.item_code
      );
      const materialName = readString(
        record.materialName ||
          record.name ||
          record.material_name ||
          record.FName ||
          record.fname ||
          record.itemName ||
          record.item_name
      );
      const quantity = readNumber(
        record.quantity || record.qty || record.FAuxQty || record.fauxqty || record.FQty || record.fqty
      );
      const unit = readString(record.unit || record.FUnit || record.funit) || "件";
      const unitPrice = readNumber(
        record.unitPrice || record.price || record.FStandardCost || record.fstandardcost || record.unit_cost
      );
      const sortValue = readString(
        record.sort || record.FSort || record.fsort || record.FShort || record.fshort
      );
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
      const normalized: BomMaterialItem = {
        entryId,
        materialCode,
        materialName,
        quantity,
        unit,
        unitPrice,
      };
      if (itemId) normalized.itemId = itemId;
      if (Number.isFinite(level) && level > 0) normalized.level = level;
      else if (sortValue) normalized.level = sortLevel;
      if (parentId) normalized.parentId = parentId;
      if (path) normalized.path = path;
      return normalized;
    })
    .filter((item): item is BomMaterialItem => item !== null);
};

const normalizeTraceBoms = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const bomNumber = readString(record.bomNumber || record.FBOMNumber || record.fbomnumber);
      const bomCode = readString(record.bomCode || record.FNumber || record.fnumber);
      const bomName = readString(record.bomName || record.FName || record.fname);
      const auxQty = readNumber(record.auxQty || record.FAuxQty || record.fauxqty);
      const audDate = readString(record.audDate || record.FAudDate || record.fauddate);
      if (!bomNumber && !bomCode && !bomName) return null;
      return { bomNumber, bomCode, bomName, auxQty, audDate };
    })
    .filter((item): item is BomTraceItem => Boolean(item));
};

const formatQtyValue = (value: number) => {
  if (!Number.isFinite(value)) return "0";
  if (Number.isInteger(value)) return String(value);
  const normalized = Number(value.toFixed(6));
  return String(normalized);
};

const formatDateValue = (value: string) => {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return value;
  return parsed.toLocaleDateString("zh-CN");
};

const isCustomerTemplateId = (id: string) => !id.trim().toUpperCase().startsWith("BOM");

const aggregateMaterials = (items: BomMaterialItem[]) => {
  const map = new Map<string, BomMaterialItem>();
  items.forEach((item) => {
    const code = item.materialCode.trim();
    const key = code || item.itemId || item.entryId || item.materialName || "";
    if (!key) return;
    const qty = Number(item.quantity);
    const normalizedQty = Number.isFinite(qty) ? qty : 0;
    const existing = map.get(key);
    if (existing) {
      existing.quantity = Number(existing.quantity) + normalizedQty;
      if (!Number.isFinite(existing.unitPrice) && Number.isFinite(item.unitPrice)) {
        existing.unitPrice = item.unitPrice;
      }
      if (!existing.itemId && item.itemId) existing.itemId = item.itemId;
      if (!existing.materialCode && item.materialCode) existing.materialCode = item.materialCode;
      if (!existing.materialName && item.materialName) existing.materialName = item.materialName;
      return;
    }
    map.set(key, { ...item, quantity: normalizedQty });
  });
  return Array.from(map.values());
};

const buildDiffItems = (baseMaterials: BomMaterialItem[], targetMaterials: BomMaterialItem[]) => {
  const normalizedBase = aggregateMaterials(baseMaterials);
  const normalizedTarget = aggregateMaterials(targetMaterials);
  const targetByCode = new Map<string, BomMaterialItem[]>();
  const targetExtras: BomMaterialItem[] = [];
  normalizedTarget.forEach((item) => {
    const code = item.materialCode.trim();
    if (!code) {
      targetExtras.push(item);
      return;
    }
    const list = targetByCode.get(code);
    if (list) {
      list.push(item);
    } else {
      targetByCode.set(code, [item]);
    }
  });

  const diffItems: BomDiffDraft[] = [];
  normalizedBase.forEach((baseItem, index) => {
    const code = baseItem.materialCode.trim();
    const matchList = code ? targetByCode.get(code) : undefined;
    const targetItem = matchList && matchList.length > 0 ? matchList.shift() : undefined;
    if (matchList && matchList.length === 0) {
      targetByCode.delete(code);
    }
    diffItems.push({
      id: `${code || baseItem.entryId || baseItem.materialName || "base"}-${index}`,
      materialCode: code || targetItem?.materialCode || "",
      materialName: baseItem.materialName || targetItem?.materialName || "",
      baseQty: formatQtyValue(baseItem.quantity),
      targetQty: formatQtyValue(targetItem?.quantity ?? 0),
      itemId: baseItem.itemId || targetItem?.itemId || "",
      unitPrice: Number.isFinite(baseItem.unitPrice)
        ? baseItem.unitPrice
        : Number.isFinite(targetItem?.unitPrice)
          ? targetItem?.unitPrice
          : undefined,
    });
  });

  const remainingTargets = [
    ...targetExtras,
    ...Array.from(targetByCode.values()).flat(),
  ];
  remainingTargets.forEach((targetItem, index) => {
    const code = targetItem.materialCode.trim();
    diffItems.push({
      id: `${code || targetItem.entryId || targetItem.materialName || "target"}-${index}`,
      materialCode: code,
      materialName: targetItem.materialName,
      baseQty: "0",
      targetQty: formatQtyValue(targetItem.quantity),
      itemId: targetItem.itemId || "",
      unitPrice: Number.isFinite(targetItem.unitPrice) ? targetItem.unitPrice : undefined,
    });
  });

  return diffItems;
};

export default function CreateProjectPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Modal & Search States
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formTemplateQuery, setFormTemplateQuery] = useState("");
  const [formTemplates, setFormTemplates] = useState<FormTemplateSummary[]>([]);
  const [selectedBaseTemplate, setSelectedBaseTemplate] = useState<FormTemplateSummary | null>(null);
  const [selectedTargetTemplateSummary, setSelectedTargetTemplateSummary] = useState<FormTemplateSummary | null>(null);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);
  const [templateError, setTemplateError] = useState("");
  const [templateReloadKey, setTemplateReloadKey] = useState(0);
  const [bomSelectMode, setBomSelectMode] = useState<"base" | "target">("base");
  const [isProjectFormModalOpen, setIsProjectFormModalOpen] = useState(false);
  const [projectFormQuery, setProjectFormQuery] = useState("");
  const [projectForms, setProjectForms] = useState<FormTemplateSummary[]>([]);
  const [selectedProjectForm, setSelectedProjectForm] = useState<FormTemplateSummary | null>(null);
  const [isLoadingProjectForms, setIsLoadingProjectForms] = useState(false);
  const [projectFormError, setProjectFormError] = useState("");
  const [projectFormReloadKey, setProjectFormReloadKey] = useState(0);
  const [isMaterialModalOpen, setIsMaterialModalOpen] = useState(false);
  const [isCustDiffPickerOpen, setIsCustDiffPickerOpen] = useState(false);
  const [materialQuery, setMaterialQuery] = useState("");
  const [materialOptions, setMaterialOptions] = useState<BomMaterialItem[]>([]);
  const [isLoadingMaterials, setIsLoadingMaterials] = useState(false);
  const [materialError, setMaterialError] = useState("");
  const [materialSelectMode, setMaterialSelectMode] = useState<"from" | "to">("from");
  const [materialSelectRowId, setMaterialSelectRowId] = useState<string | null>(null);
  const [rawReplaceBomMap, setRawReplaceBomMap] = useState<Record<string, BomTraceItem[]>>({});
  const [rawReplaceBomLoading, setRawReplaceBomLoading] = useState<Record<string, boolean>>({});
  const [rawReplaceBomError, setRawReplaceBomError] = useState<Record<string, string>>({});
  const [rawReplaceBomFolded, setRawReplaceBomFolded] = useState<Record<string, boolean>>({});
  const [rawReplaceItemIdMap, setRawReplaceItemIdMap] = useState<Record<string, string>>({});
  const [diffTraceMap, setDiffTraceMap] = useState<Record<string, BomTraceItem[]>>({});
  const [diffTraceLoading, setDiffTraceLoading] = useState<Record<string, boolean>>({});
  const [diffTraceError, setDiffTraceError] = useState<Record<string, string>>({});
  const [diffTraceFolded, setDiffTraceFolded] = useState<Record<string, boolean>>({});
  const autoTraceLoadRef = useRef<Set<string>>(new Set());

  const [formData, setFormData] = useState<FormState>({
    formTemplateId: undefined,
    bomChangeType: "materialAdjust",
    bomTargetId: undefined,
    bomDiffItems: [
      { id: "d1", materialCode: "", materialName: "", baseQty: "", targetQty: "", itemId: "" },
    ],
    bomMaterialAdjustments: [
      {
        id: "m1",
        materialCode: "",
        materialName: "",
        oldPrice: "",
        newPrice: "",
        replaceFromCode: "",
        replaceFromName: "",
        replaceToCode: "",
        replaceToName: "",
      },
    ],
    bomCode: "",
    bomTargetCode: "",
  });
  const [basicInfo, setBasicInfo] = useState({
    name: "",
    initiator: "",
    problem: "",
    goal: "",
    actions: "",
    resources: "",
    cycle: "",
    benefit: "",
    approval: "",
  });
  const [baseMaterials, setBaseMaterials] = useState<BomMaterialItem[]>([]);
  const [targetMaterials, setTargetMaterials] = useState<BomMaterialItem[]>([]);
  const [baseCustDiffOptions, setBaseCustDiffOptions] = useState<BomMaterialItem[]>([]);
  const [baseCustDiffLoading, setBaseCustDiffLoading] = useState(false);
  const [baseCustDiffError, setBaseCustDiffError] = useState("");
  const [baseCustDiffSelected, setBaseCustDiffSelected] = useState<Record<string, boolean>>({});
  const [baseCustDiffQuery, setBaseCustDiffQuery] = useState("");
  const [baseCustDiffExpanded, setBaseCustDiffExpanded] = useState<Record<string, boolean>>({});
  const [targetCustDiffOptions, setTargetCustDiffOptions] = useState<BomMaterialItem[]>([]);
  const [targetCustDiffLoading, setTargetCustDiffLoading] = useState(false);
  const [targetCustDiffError, setTargetCustDiffError] = useState("");
  const [targetCustDiffSelected, setTargetCustDiffSelected] = useState<Record<string, boolean>>({});
  const [targetCustDiffQuery, setTargetCustDiffQuery] = useState("");
  const [targetCustDiffExpanded, setTargetCustDiffExpanded] = useState<Record<string, boolean>>({});
  const [useCustDiffSelection, setUseCustDiffSelection] = useState(true);
  const [mainTab, setMainTab] = useState<"basic" | "plan" | "cost">("plan");
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");

  const canCreate = useMemo(() => {
    if (!currentUser) return false;
    return currentUser.role === "admin" || currentUser.role === "manager";
  }, [currentUser]);
  const isCustomerMode = formData.bomChangeType === "materialAdjust";
  const canUseCustDiffSelection =
    formData.bomChangeType === "replace" || formData.bomChangeType === "materialAdjust";
  const canEditBasic = canCreate && Boolean(selectedProjectId);

  const resetRawReplaceState = () => {
    setRawReplaceBomMap({});
    setRawReplaceBomLoading({});
    setRawReplaceBomError({});
    setRawReplaceBomFolded({});
    setRawReplaceItemIdMap({});
  };
  const resetDiffTraceState = () => {
    setDiffTraceMap({});
    setDiffTraceLoading({});
    setDiffTraceError({});
    setDiffTraceFolded({});
  };

  // Load User
  useEffect(() => {
    let active = true;
    Promise.resolve()
      .then(() => fetch("/api/auth/me"))
      .then(async (meResponse) => {
        if (!active) return;
        if (meResponse.status === 401) {
          router.replace("/login");
          return;
        }
        if (!meResponse.ok) {
          setErrorMessage("加载用户信息失败");
          setIsLoading(false);
          return;
        }
        const user = (await meResponse.json()) as User;
        if (!active) return;
        setCurrentUser(user);
        setIsLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setErrorMessage("网络异常，加载失败");
        setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    if (!currentUser) return;
    let active = true;
    Promise.resolve()
      .then(() => fetch("/api/projects?summary=1"))
      .then(async (resp) => {
        if (!active || !resp || !resp.ok) return;
        const list = (await resp.json()) as Array<{ id: string; name: string }>;
        if (!active) return;
        setProjects(list.map((p) => ({ id: p.id, name: p.name })));
      })
      .catch(() => {})
      .finally(() => {
        if (!active) return;
        active = false;
      });
  }, [currentUser]);

  // Load Templates (Debounced) - Only when modal is open
  useEffect(() => {
    if (!currentUser || !isModalOpen) return;
    
    let active = true;
    setIsLoadingTemplates(true);
    setTemplateError("");

    const timer = setTimeout(() => {
      void (async () => {
        try {
          const queryParams = new URLSearchParams({ query: formTemplateQuery });
          if (isCustomerMode) {
            queryParams.set("customer", "1");
          }
          const response = await fetch(`/api/forms?${queryParams.toString()}`, { cache: "no-store" });
          if (!active) return;
          if (response.status === 401) {
            router.replace("/login");
            return;
          }
          if (!response.ok) {
            const msg = await response.json().catch(() => null);
            setTemplateError(typeof msg?.message === "string" ? msg.message : "加载表单列表失败");
            return;
          }
          const data = (await response.json()) as FormTemplateSummary[];
          if (!active) return;
          setFormTemplates(Array.isArray(data) ? data : []);
        } catch {
          if (!active) return;
          setTemplateError("网络异常，加载表单失败");
        } finally {
          if (!active) return;
          setIsLoadingTemplates(false);
        }
      })();
    }, 300);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [currentUser, formTemplateQuery, isModalOpen, router, templateReloadKey, isCustomerMode]);

  useEffect(() => {
    if (!currentUser || !isProjectFormModalOpen) return;
    let active = true;
    setIsLoadingProjectForms(true);
    setProjectFormError("");
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const queryParams = new URLSearchParams({ query: projectFormQuery, project: "1" });
          const response = await fetch(`/api/forms?${queryParams.toString()}`, { cache: "no-store" });
          if (!active) return;
          if (response.status === 401) {
            router.replace("/login");
            return;
          }
          if (!response.ok) {
            const msg = await response.json().catch(() => null);
            setProjectFormError(typeof msg?.message === "string" ? msg.message : "加载立项表失败");
            return;
          }
          const data = (await response.json()) as FormTemplateSummary[];
          if (!active) return;
          setProjectForms(Array.isArray(data) ? data : []);
        } catch {
          setProjectFormError("网络异常，加载立项表失败");
        } finally {
          if (active) setIsLoadingProjectForms(false);
        }
      })();
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [currentUser, isProjectFormModalOpen, projectFormQuery, router, projectFormReloadKey]);

  useEffect(() => {
    if (!currentUser || !isMaterialModalOpen) return;

    let active = true;
    setIsLoadingMaterials(true);
    setMaterialError("");

    const timer = setTimeout(() => {
      void (async () => {
        try {
          const queryParams = new URLSearchParams({ query: materialQuery });
          const response = await fetch(`/api/materials?${queryParams.toString()}`, { cache: "no-store" });
          if (!active) return;
          if (response.status === 401) {
            router.replace("/login");
            return;
          }
          if (!response.ok) {
            const msg = await response.json().catch(() => null);
            setMaterialError(typeof msg?.message === "string" ? msg.message : "加载物料列表失败");
            return;
          }
          const data = (await response.json()) as { items?: unknown } | unknown[];
          if (!active) return;
          if (Array.isArray(data)) {
            setMaterialOptions(normalizeMaterials(data));
          } else {
            setMaterialOptions(normalizeMaterials((data as { items?: unknown })?.items));
          }
        } catch {
          if (!active) return;
          setMaterialError("网络异常，加载物料失败");
        } finally {
          if (!active) return;
          setIsLoadingMaterials(false);
        }
      })();
    }, 300);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [currentUser, materialQuery, isMaterialModalOpen, router]);

  const toDiffDrafts = (items?: BomDiffItem[]) => {
    if (!items || items.length === 0) {
      return [{ id: "d1", materialCode: "", materialName: "", baseQty: "", targetQty: "", itemId: "" }];
    }
    return items.map((item, index) => ({
      id: `loaded-diff-${index}`,
      materialCode: item.materialCode || "",
      materialName: item.materialName || "",
      baseQty: formatQtyValue(item.baseQty),
      targetQty: formatQtyValue(item.targetQty),
      itemId: item.itemId || "",
    }));
  };

  const toAdjustmentDrafts = (items?: BomMaterialAdjustment[]) => {
    if (!items || items.length === 0) {
      return [
        {
          id: "m1",
          materialCode: "",
          materialName: "",
          oldPrice: "",
          newPrice: "",
          replaceFromCode: "",
          replaceFromName: "",
          replaceToCode: "",
          replaceToName: "",
        },
      ];
    }
    return items.map((item, index) => ({
      id: `loaded-adj-${index}`,
      materialCode: item.materialCode || "",
      materialName: item.materialName || "",
      oldPrice: Number.isFinite(item.oldPrice) ? String(item.oldPrice) : "0",
      newPrice: Number.isFinite(item.newPrice) ? String(item.newPrice) : "0",
      replaceFromCode: item.replaceFromCode || item.materialCode || "",
      replaceFromName: item.replaceFromName || item.materialName || "",
      replaceToCode: item.replaceToCode || "",
      replaceToName: item.replaceToName || "",
    }));
  };

  const handleProjectSelect = (projectId: string) => {
    setSelectedProjectId(projectId);
    if (!projectId) {
      setIsModalOpen(false);
      setSelectedProjectForm(null);
      setFormData((prev) => ({
        ...prev,
        formTemplateId: undefined,
        bomTargetId: undefined,
        bomChangeType: "materialAdjust",
        bomDiffItems: toDiffDrafts(undefined),
        bomMaterialAdjustments: toAdjustmentDrafts(undefined),
        bomCode: "",
        bomTargetCode: "",
      }));
      setBaseMaterials([]);
      setTargetMaterials([]);
      setBaseOnlyOrder([]);
      setTargetOnlyOrder([]);
      setBasicInfo({
        name: "",
        initiator: "",
        problem: "",
        goal: "",
        actions: "",
        resources: "",
        cycle: "",
        benefit: "",
        approval: "",
      });
      resetDiffTraceState();
      resetRawReplaceState();
      return;
    }
    setSelectedProjectForm(null);
    setFormData((prev) => ({
      ...prev,
      formTemplateId: undefined,
      bomTargetId: undefined,
      bomChangeType: "materialAdjust",
      bomDiffItems: toDiffDrafts(undefined),
      bomMaterialAdjustments: toAdjustmentDrafts(undefined),
      bomCode: "",
      bomTargetCode: "",
    }));
    setBaseMaterials([]);
    setTargetMaterials([]);
    resetDiffTraceState();
    resetRawReplaceState();
    void (async () => {
      const response = await fetch(`/api/projects/${projectId}?summary=1`, { cache: "no-store" });
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      if (response.status === 403) {
        setErrorMessage("无权限查看项目");
        return;
      }
      if (!response.ok) {
        setErrorMessage("加载项目失败");
        return;
      }
      const data = (await response.json()) as { project: Project };
      const project = data.project;
      setBasicInfo({
        name: project.name || "",
        initiator: project.initiator || "",
        problem: project.problem || "",
        goal: project.goal || "",
        actions: project.actions || "",
        resources: project.resources || "",
        cycle: project.cycle || "",
        benefit: project.benefit || "",
        approval: project.approval || "",
      });
      const mappedBomChangeType =
        project.bomChangeType === "rawMaterialReplace" ? "materialAdjust" : project.bomChangeType;
      const nextBomChangeType = mappedBomChangeType || "materialAdjust";
      const diffTraceItems = Array.isArray(project.bomDiffTraceItems) ? project.bomDiffTraceItems : [];
      const rawReplaceTraceItems = Array.isArray(project.bomRawReplaceTraceItems)
        ? project.bomRawReplaceTraceItems
        : [];
      const baseTemplate =
        project.formTemplateId && project.formTemplateName
          ? {
              id: project.formTemplateId,
              name: project.formTemplateName,
              code: project.formTemplateId,
              bomNumber: project.formTemplateId,
              createdAt: "",
            }
          : null;
      const targetTemplate =
        project.bomTargetId && project.bomTargetName
          ? {
              id: project.bomTargetId,
              name: project.bomTargetName,
              code: project.bomTargetId,
              bomNumber: project.bomTargetId,
              createdAt: "",
            }
          : null;
      setFormData((prev) => ({
        ...prev,
        formTemplateId: project.formTemplateId || undefined,
        bomTargetId: project.bomTargetId || undefined,
        bomChangeType: nextBomChangeType,
        bomDiffItems: toDiffDrafts(project.bomDiffItems),
        bomMaterialAdjustments: toAdjustmentDrafts(project.bomMaterialAdjustments),
        bomCode: project.formTemplateId || "",
        bomTargetCode: project.bomTargetId || "",
      }));
      setSelectedBaseTemplate(baseTemplate);
      setSelectedTargetTemplateSummary(targetTemplate);
      setBaseOnlyOrder(Array.isArray(project.bomDiffBaseOrder) ? project.bomDiffBaseOrder : []);
      setTargetOnlyOrder(Array.isArray(project.bomDiffTargetOrder) ? project.bomDiffTargetOrder : []);
      if (diffTraceItems.length > 0) {
        setDiffTraceMap(
          diffTraceItems.reduce<Record<string, BomTraceItem[]>>((acc, items, index) => {
            acc[`loaded-diff-${index}`] = Array.isArray(items) ? items : [];
            return acc;
          }, {})
        );
        setDiffTraceFolded(
          diffTraceItems.reduce<Record<string, boolean>>((acc, _, index) => {
            acc[`loaded-diff-${index}`] = true;
            return acc;
          }, {})
        );
      }
      if (rawReplaceTraceItems.length > 0) {
        setRawReplaceBomMap(
          rawReplaceTraceItems.reduce<Record<string, BomTraceItem[]>>((acc, items, index) => {
            acc[`loaded-adj-${index}`] = Array.isArray(items) ? items : [];
            return acc;
          }, {})
        );
        setRawReplaceBomFolded(
          rawReplaceTraceItems.reduce<Record<string, boolean>>((acc, _, index) => {
            acc[`loaded-adj-${index}`] = false;
            return acc;
          }, {})
        );
      }
    })().catch(() => {
      setErrorMessage("网络异常，加载失败");
    });
  };

  const handleSelectFromModal = (template: FormTemplateSummary) => {
    if (bomSelectMode === "base") {
      setFormData((prev) => ({
        ...prev,
        formTemplateId: template.id,
        bomCode: template.bomNumber || template.code || template.id,
      }));
      setSelectedBaseTemplate(template);
    } else {
      setFormData((prev) => ({
        ...prev,
        bomTargetId: template.id,
        bomTargetCode: template.bomNumber || template.code || template.id,
      }));
      setSelectedTargetTemplateSummary(template);
    }
    resetDiffTraceState();
    setIsModalOpen(false);
  };

  const handleReloadTemplates = () => {
    setTemplateReloadKey((prev) => prev + 1);
  };

  const handleClearSelection = () => {
    setFormData((prev) => ({
      ...prev,
      formTemplateId: undefined,
      bomCode: "",
    }));
    setSelectedBaseTemplate(null);
    resetDiffTraceState();
  };

  const handleClearTargetSelection = () => {
    setFormData((prev) => ({
      ...prev,
      bomTargetId: undefined,
      bomTargetCode: "",
    }));
    setSelectedTargetTemplateSummary(null);
    resetDiffTraceState();
  };

  const handleReloadProjectForms = () => {
    setProjectFormReloadKey((prev) => prev + 1);
  };

  const handleSelectProjectForm = (template: FormTemplateSummary) => {
    setSelectedProjectForm(template);
    setIsProjectFormModalOpen(false);
    setProjectFormError("");
    void (async () => {
      const queryParams = new URLSearchParams({ id: template.id, project: "1" });
      const response = await fetch(`/api/forms?${queryParams.toString()}`, { cache: "no-store" });
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      if (!response.ok) {
        const msg = await response.json().catch(() => null);
        setProjectFormError(typeof msg?.message === "string" ? msg.message : "加载立项表失败");
        return;
      }
      const data = (await response.json()) as { project?: Partial<typeof basicInfo> };
      const project = (data?.project ?? {}) as Partial<typeof basicInfo>;
      setBasicInfo((prev) => ({
        name: project.name || prev.name,
        initiator: project.initiator || prev.initiator,
        problem: project.problem || prev.problem,
        goal: project.goal || prev.goal,
        actions: project.actions || prev.actions,
        resources: project.resources || prev.resources,
        cycle: project.cycle || prev.cycle,
        benefit: project.benefit || prev.benefit,
        approval: project.approval || prev.approval,
      }));
    })();
  };

  const handleClearProjectForm = () => {
    setSelectedProjectForm(null);
  };

  const openMaterialModal = (rowId: string, mode: "from" | "to") => {
    if (!canCreate) return;
    setMaterialSelectRowId(rowId);
    setMaterialSelectMode(mode);
    setIsMaterialModalOpen(true);
  };

  const loadRawReplaceBoms = (rowId: string, itemId: string) => {
    if (!itemId) return;
    setRawReplaceBomLoading((prev) => ({ ...prev, [rowId]: true }));
    setRawReplaceBomError((prev) => ({ ...prev, [rowId]: "" }));
    void fetch(`/api/materials?itemId=${encodeURIComponent(itemId)}`, { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        if (!response.ok) {
          setRawReplaceBomError((prev) => ({ ...prev, [rowId]: "加载关联BOM失败" }));
          setRawReplaceBomMap((prev) => ({ ...prev, [rowId]: [] }));
          return;
        }
        const data = (await response.json()) as { boms?: unknown };
        const next = normalizeTraceBoms(data?.boms);
        setRawReplaceBomMap((prev) => ({ ...prev, [rowId]: next }));
        setRawReplaceBomFolded((prev) => ({ ...prev, [rowId]: false }));
      })
      .catch(() => {
        setRawReplaceBomError((prev) => ({ ...prev, [rowId]: "网络异常，加载失败" }));
        setRawReplaceBomMap((prev) => ({ ...prev, [rowId]: [] }));
      })
      .finally(() => {
        setRawReplaceBomLoading((prev) => ({ ...prev, [rowId]: false }));
      });
  };

  const loadDiffTraceBoms = useCallback((rowId: string, itemId: string) => {
    if (!itemId) return;
    setDiffTraceLoading((prev) => ({ ...prev, [rowId]: true }));
    setDiffTraceError((prev) => ({ ...prev, [rowId]: "" }));
    void fetch(`/api/materials?itemId=${encodeURIComponent(itemId)}`, { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        if (!response.ok) {
          setDiffTraceError((prev) => ({ ...prev, [rowId]: "加载关联BOM失败" }));
          setDiffTraceMap((prev) => ({ ...prev, [rowId]: [] }));
          return;
        }
        const data = (await response.json()) as { boms?: unknown };
        const next = normalizeTraceBoms(data?.boms);
        setDiffTraceMap((prev) => ({ ...prev, [rowId]: next }));
        setDiffTraceFolded((prev) => ({ ...prev, [rowId]: true }));
      })
      .catch(() => {
        setDiffTraceError((prev) => ({ ...prev, [rowId]: "网络异常，加载失败" }));
        setDiffTraceMap((prev) => ({ ...prev, [rowId]: [] }));
      })
      .finally(() => {
        setDiffTraceLoading((prev) => ({ ...prev, [rowId]: false }));
      });
  }, [router]);

  useEffect(() => {
    const drafts = (formData.bomDiffItems || []).filter((item) => item.materialCode.trim() || item.materialName.trim());
    drafts.forEach((item) => {
      const itemId = item.itemId?.trim() || "";
      if (!itemId) return;
      const key = `${item.id}`;
      const traceItems = diffTraceMap[item.id];
      const loading = diffTraceLoading[item.id];
      if ((traceItems && traceItems.length > 0) || loading || autoTraceLoadRef.current.has(key)) return;
      autoTraceLoadRef.current.add(key);
      loadDiffTraceBoms(item.id, itemId);
    });
  }, [formData.bomDiffItems, diffTraceMap, diffTraceLoading, loadDiffTraceBoms]);

  const handleSelectMaterial = (material: BomMaterialItem) => {
    if (!materialSelectRowId) return;
    setFormData((prev) => ({
      ...prev,
      bomMaterialAdjustments: (prev.bomMaterialAdjustments || []).map((item) => {
        if (item.id !== materialSelectRowId) return item;
        if (materialSelectMode === "from") {
          return {
            ...item,
            materialCode: material.materialCode,
            materialName: material.materialName,
            replaceFromCode: material.materialCode,
            replaceFromName: material.materialName,
          };
        }
        return {
          ...item,
          replaceToCode: material.materialCode,
          replaceToName: material.materialName,
        };
      }),
    }));
    if (materialSelectMode === "from") {
      const nextItemId = material.itemId || material.entryId;
      setRawReplaceItemIdMap((prev) => ({ ...prev, [materialSelectRowId]: nextItemId }));
      loadRawReplaceBoms(materialSelectRowId, nextItemId);
    }
    setIsMaterialModalOpen(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    if (!selectedProjectId) {
      setErrorMessage("请选择要引入的项目");
      return;
    }
    setErrorMessage("");
    setIsSubmitting(true);
    void (async () => {
      const isDiffMode =
        formData.bomChangeType === "replace" || formData.bomChangeType === "materialAdjust";
      const isRawAdjustMode =
        formData.bomChangeType === "materialAdjust" ||
        formData.bomChangeType === "rawMaterialReplace";
      const diffDrafts = isDiffMode
        ? (formData.bomDiffItems || []).filter(
            (item) => item.materialCode.trim() || item.materialName.trim()
          )
        : [];
      const diffItems = diffDrafts.map((item) => {
        const baseQty = parseNumber(item.baseQty);
        const targetQty = parseNumber(item.targetQty);
        return {
          materialCode: item.materialCode.trim(),
          materialName: item.materialName.trim(),
          baseQty,
          targetQty,
          delta: targetQty - baseQty,
          itemId: item.itemId?.trim() || undefined,
        };
      });
      const diffTraceItems = diffDrafts.map((item) => diffTraceMap[item.id] || []);
      const adjustmentDrafts = isRawAdjustMode
        ? (formData.bomMaterialAdjustments || []).filter(
            (item) =>
              item.replaceFromCode.trim() ||
              item.replaceFromName.trim() ||
              item.replaceToCode.trim() ||
              item.replaceToName.trim()
          )
        : [];
      const materialAdjustments = adjustmentDrafts.map((item) => ({
        materialCode: item.replaceFromCode.trim(),
        materialName: item.replaceFromName.trim(),
        oldPrice: 0,
        newPrice: 0,
        delta: 0,
        replaceFromCode: item.replaceFromCode.trim(),
        replaceFromName: item.replaceFromName.trim(),
        replaceToCode: item.replaceToCode.trim(),
        replaceToName: item.replaceToName.trim(),
      }));
      const rawReplaceTraceItems = adjustmentDrafts.map((item) => rawReplaceBomMap[item.id] || []);
    const baseName =
      selectedTemplate?.name && selectedTemplate.name !== "已选择表单" ? selectedTemplate.name : undefined;
    const targetName =
      selectedTargetTemplate?.name && selectedTargetTemplate.name !== "已选择表单"
        ? selectedTargetTemplate.name
        : undefined;
      const baseOrderKeys = orderedBaseOnly.map((item) => getDiffOrderKey(item));
      const targetOrderKeys = orderedTargetOnly.map((item) => getDiffOrderKey(item));
      const requestBody = {
        name: basicInfo.name.trim(),
        initiator: basicInfo.initiator.trim(),
        problem: basicInfo.problem.trim(),
        goal: basicInfo.goal.trim(),
        actions: basicInfo.actions.trim(),
        resources: basicInfo.resources.trim(),
        cycle: basicInfo.cycle.trim(),
        benefit: basicInfo.benefit.trim(),
        approval: basicInfo.approval.trim(),
        bomChangeType: formData.bomChangeType,
        formTemplateId: formData.formTemplateId || undefined,
      formTemplateName: baseName,
        bomTargetId: formData.bomTargetId || undefined,
      bomTargetName: targetName,
        bomDiffItems: diffItems,
        bomMaterialAdjustments: materialAdjustments,
        bomDiffTraceItems: diffTraceItems,
        bomRawReplaceTraceItems: rawReplaceTraceItems,
        bomDiffBaseOrder: baseOrderKeys,
        bomDiffTargetOrder: targetOrderKeys,
      };
      const response = await fetch(`/api/projects/${selectedProjectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      if (response.status === 403) {
        setErrorMessage("无权限保存项目");
        return;
      }
      if (!response.ok) {
        setErrorMessage("保存项目失败");
        return;
      }
      const project = (await response.json()) as Project;
      router.push(`/project/${project.id}`);
    })()
      .catch(() => {
        setErrorMessage("网络异常，保存失败");
      })
      .finally(() => {
        setIsSubmitting(false);
      });
  };

  useEffect(() => {
    if (!formData.formTemplateId) {
      setSelectedBaseTemplate(null);
      return;
    }
    const match = formTemplates.find((template) => template.id === formData.formTemplateId);
    if (match) setSelectedBaseTemplate(match);
  }, [formData.formTemplateId, formTemplates]);

  useEffect(() => {
    if (!formData.bomTargetId) {
      setSelectedTargetTemplateSummary(null);
      return;
    }
    const match = formTemplates.find((template) => template.id === formData.bomTargetId);
    if (match) setSelectedTargetTemplateSummary(match);
  }, [formData.bomTargetId, formTemplates]);

  useEffect(() => {
    const id = formData.formTemplateId;
    if (!id) return;
    if (selectedBaseTemplate?.id === id && selectedBaseTemplate.name) return;
    let active = true;
    const queryParams = new URLSearchParams({ id });
    if (isCustomerTemplateId(id)) queryParams.set("customer", "1");
    void fetch(`/api/forms?${queryParams.toString()}`, { cache: "no-store" })
      .then(async (response) => {
        if (!active) return;
        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        if (!response.ok) return;
        const data = (await response.json()) as FormTemplateSummary;
        if (!active) return;
        if (data && typeof data.id === "string" && data.id === id) {
          setSelectedBaseTemplate(data);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [formData.formTemplateId, isCustomerMode, router, selectedBaseTemplate?.id, selectedBaseTemplate?.name]);

  useEffect(() => {
    const id = formData.bomTargetId;
    if (!id) return;
    if (selectedTargetTemplateSummary?.id === id && selectedTargetTemplateSummary.name) return;
    let active = true;
    const queryParams = new URLSearchParams({ id });
    if (isCustomerTemplateId(id)) queryParams.set("customer", "1");
    void fetch(`/api/forms?${queryParams.toString()}`, { cache: "no-store" })
      .then(async (response) => {
        if (!active) return;
        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        if (!response.ok) return;
        const data = (await response.json()) as FormTemplateSummary;
        if (!active) return;
        if (data && typeof data.id === "string" && data.id === id) {
          setSelectedTargetTemplateSummary(data);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [formData.bomTargetId, isCustomerMode, router, selectedTargetTemplateSummary?.id, selectedTargetTemplateSummary?.name]);

  const selectedTemplate = useMemo(() => {
    if (!formData.formTemplateId) return null;
    if (selectedBaseTemplate?.id === formData.formTemplateId) return selectedBaseTemplate;
    const match = formTemplates.find((template) => template.id === formData.formTemplateId);
    if (match) return match;
    return {
      id: formData.formTemplateId,
      name: selectedBaseTemplate?.name || "已选择表单",
      code: selectedBaseTemplate?.code || formData.formTemplateId,
      bomNumber: selectedBaseTemplate?.bomNumber,
      createdAt: "",
    };
  }, [formData.formTemplateId, formTemplates, selectedBaseTemplate]);

  const selectedTargetTemplate = useMemo(() => {
    if (!formData.bomTargetId) return null;
    if (selectedTargetTemplateSummary?.id === formData.bomTargetId) return selectedTargetTemplateSummary;
    const match = formTemplates.find((template) => template.id === formData.bomTargetId);
    if (match) return match;
    return {
      id: formData.bomTargetId,
      name: selectedTargetTemplateSummary?.name || "已选择表单",
      code: selectedTargetTemplateSummary?.code || formData.bomTargetId,
      bomNumber: selectedTargetTemplateSummary?.bomNumber,
      createdAt: "",
    };
  }, [formData.bomTargetId, formTemplates, selectedTargetTemplateSummary]);

  useEffect(() => {
    const id = formData.formTemplateId;
    if (!id) {
      setBaseMaterials([]);
      return;
    }
    let active = true;
    const queryParams = new URLSearchParams({ id, materials: "1" });
    if (isCustomerMode) {
      queryParams.set("customer", "1");
    }
    void fetch(`/api/forms?${queryParams.toString()}`, { cache: "no-store" })
      .then(async (response) => {
        if (!active) return;
        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        if (!response.ok) {
          setBaseMaterials([]);
          return;
        }
        const data = (await response.json()) as { materials?: unknown };
        if (!active) return;
        setBaseMaterials(normalizeMaterials(data.materials));
      })
      .catch(() => {
        if (!active) return;
        setBaseMaterials([]);
      });
    return () => {
      active = false;
    };
  }, [formData.formTemplateId, router, isCustomerMode]);

  useEffect(() => {
    const id = formData.bomTargetId;
    if (!id) {
      setTargetMaterials([]);
      return;
    }
    let active = true;
    const queryParams = new URLSearchParams({ id, materials: "1" });
    if (isCustomerMode) {
      queryParams.set("customer", "1");
    }
    void fetch(`/api/forms?${queryParams.toString()}`, { cache: "no-store" })
      .then(async (response) => {
        if (!active) return;
        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        if (!response.ok) {
          setTargetMaterials([]);
          return;
        }
        const data = (await response.json()) as { materials?: unknown };
        if (!active) return;
        setTargetMaterials(normalizeMaterials(data.materials));
      })
      .catch(() => {
        if (!active) return;
        setTargetMaterials([]);
      });
    return () => {
      active = false;
    };
  }, [formData.bomTargetId, router, isCustomerMode]);

  const baseBomNumber =
    selectedBaseTemplate?.bomNumber || formData.bomCode || selectedBaseTemplate?.code || "";
  const targetBomNumber =
    selectedTargetTemplate?.bomNumber || formData.bomTargetCode || selectedTargetTemplate?.code || "";
  const loadBaseCustDiffOptions = useCallback(() => {
    if (!baseBomNumber) return;
    let active = true;
    setBaseCustDiffLoading(true);
    setBaseCustDiffError("");
    const queryParams = new URLSearchParams({ custDiff: "1", id: baseBomNumber });
    void fetch(`/api/forms?${queryParams.toString()}`, { cache: "no-store" })
      .then(async (response) => {
        if (!active) return;
        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        if (!response.ok) {
          let message = "加载差异候选失败";
          try {
            const payload = (await response.json()) as { message?: unknown };
            if (payload && typeof payload.message === "string" && payload.message.trim()) {
              message = payload.message;
            }
          } catch {}
          setBaseCustDiffOptions([]);
          setBaseCustDiffError(message);
          return;
        }
        const data = (await response.json()) as { items?: unknown };
        if (!active) return;
        const items = normalizeMaterials(data.items);
        setBaseCustDiffOptions(items);
        setBaseCustDiffSelected({});
        setUseCustDiffSelection(true);
      })
      .catch(() => {
        if (!active) return;
        setBaseCustDiffOptions([]);
        setBaseCustDiffError("加载差异候选失败");
      })
      .finally(() => {
        if (!active) return;
        setBaseCustDiffLoading(false);
      });
    return () => {
      active = false;
    };
  }, [baseBomNumber, router]);
  const loadTargetCustDiffOptions = useCallback(() => {
    if (!targetBomNumber) return;
    let active = true;
    setTargetCustDiffLoading(true);
    setTargetCustDiffError("");
    const queryParams = new URLSearchParams({ custDiff: "1", id: targetBomNumber });
    void fetch(`/api/forms?${queryParams.toString()}`, { cache: "no-store" })
      .then(async (response) => {
        if (!active) return;
        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        if (!response.ok) {
          let message = "加载差异候选失败";
          try {
            const payload = (await response.json()) as { message?: unknown };
            if (payload && typeof payload.message === "string" && payload.message.trim()) {
              message = payload.message;
            }
          } catch {}
          setTargetCustDiffOptions([]);
          setTargetCustDiffError(message);
          return;
        }
        const data = (await response.json()) as { items?: unknown };
        if (!active) return;
        const items = normalizeMaterials(data.items);
        setTargetCustDiffOptions(items);
        setTargetCustDiffSelected({});
        setUseCustDiffSelection(true);
      })
      .catch(() => {
        if (!active) return;
        setTargetCustDiffOptions([]);
        setTargetCustDiffError("加载差异候选失败");
      })
      .finally(() => {
        if (!active) return;
        setTargetCustDiffLoading(false);
      });
    return () => {
      active = false;
    };
  }, [targetBomNumber, router]);

  useEffect(() => {
    if (formData.bomChangeType !== "replace" && formData.bomChangeType !== "materialAdjust") return;
    setUseCustDiffSelection(true);
    if (!baseBomNumber) {
      setBaseCustDiffOptions([]);
      setBaseCustDiffSelected({});
      setBaseCustDiffError("");
    } else {
      loadBaseCustDiffOptions();
    }
  }, [baseBomNumber, formData.bomChangeType, loadBaseCustDiffOptions]);

  useEffect(() => {
    if (formData.bomChangeType !== "replace" && formData.bomChangeType !== "materialAdjust") return;
    setUseCustDiffSelection(true);
    if (!targetBomNumber) {
      setTargetCustDiffOptions([]);
      setTargetCustDiffSelected({});
      setTargetCustDiffError("");
      return;
    }
    loadTargetCustDiffOptions();
  }, [targetBomNumber, formData.bomChangeType, loadTargetCustDiffOptions]);

  useEffect(() => {
    if (formData.bomChangeType !== "replace" && formData.bomChangeType !== "materialAdjust") return;
    if (useCustDiffSelection) return;
    const nextDiffItems = buildDiffItems(baseMaterials, targetMaterials);
    setFormData((prev) => ({
      ...prev,
      bomDiffItems: nextDiffItems,
    }));
  }, [baseMaterials, targetMaterials, formData.bomChangeType, useCustDiffSelection]);
  const [isDiffOpen, setIsDiffOpen] = useState(false);
  const [isBaseBomDetailOpen, setIsBaseBomDetailOpen] = useState(true);
  const [isTargetBomDetailOpen, setIsTargetBomDetailOpen] = useState(true);
  const canEditBom = Boolean(selectedProjectId) && canCreate;
  const baseTotal = useMemo(
    () => baseMaterials.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0),
    [baseMaterials]
  );
  const targetTotal = useMemo(
    () => targetMaterials.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0),
    [targetMaterials]
  );
  const costLinkItems = useMemo(() => {
    const delta = baseTotal - targetTotal;
    return baseCostLinks.map((item) =>
      item.id === "oa-01" ? { ...item, amount: delta } : item
    );
  }, [baseTotal, targetTotal]);
  const costLinkTotal = useMemo(
    () => costLinkItems.reduce((sum, item) => sum + item.amount, 0),
    [costLinkItems]
  );
  const getEntrySortValue = (item: BomMaterialItem) => {
    const value = Number(item.entryId);
    return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
  };
  const sortedBaseMaterials = useMemo(
    () => [...baseMaterials].sort((a, b) => getEntrySortValue(a) - getEntrySortValue(b)),
    [baseMaterials]
  );
  const sortedTargetMaterials = useMemo(
    () => [...targetMaterials].sort((a, b) => getEntrySortValue(a) - getEntrySortValue(b)),
    [targetMaterials]
  );

  const updateBomChangeType = (next: BomChangeType) => {
    if (!canEditBom) return;
    if (formData.bomChangeType === next) return;
    setFormData((prev) => ({
      ...prev,
      bomChangeType: next,
      formTemplateId: undefined,
      bomTargetId: undefined,
      bomDiffItems: toDiffDrafts(undefined),
      bomMaterialAdjustments: toAdjustmentDrafts(undefined),
      bomCode: "",
      bomTargetCode: "",
    }));
    setBaseMaterials([]);
    setTargetMaterials([]);
    setBomSelectMode("base");
    resetRawReplaceState();
  };

  useEffect(() => {
    if (formData.formTemplateId || formData.bomTargetId) {
      setIsDiffOpen(true);
      setIsBaseBomDetailOpen(false);
      setIsTargetBomDetailOpen(false);
    }
  }, [formData.formTemplateId, formData.bomTargetId]);

  const removeDiffTraceItem = (id: string, index: number) => {
    setDiffTraceMap((prev) => ({
      ...prev,
      [id]: (prev[id] || []).filter((_, itemIndex) => itemIndex !== index),
    }));
  };

  const toggleBaseCustDiffSelection = (key: string) => {
    setBaseCustDiffSelected((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleTargetCustDiffSelection = (key: string) => {
    setTargetCustDiffSelected((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleBaseCustDiffExpanded = (key: string) => {
    setBaseCustDiffExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleTargetCustDiffExpanded = (key: string) => {
    setTargetCustDiffExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const buildCustDiffItems = () => {
    const map = new Map<string, BomDiffDraft>();
    baseCustDiffOptions.forEach((item) => {
      const key = getCustDiffKey(item);
      if (!baseCustDiffSelected[key]) return;
      const next: BomDiffDraft = {
        id: `cust-diff-base-${key}`,
        materialCode: item.materialCode || "",
        materialName: item.materialName || "",
        baseQty: formatQtyValue(item.quantity),
        targetQty: "0",
        itemId: item.itemId || "",
        unitPrice: Number.isFinite(item.unitPrice) ? item.unitPrice : undefined,
      };
      map.set(key, next);
    });
    targetCustDiffOptions.forEach((item) => {
      const key = getCustDiffKey(item);
      if (!targetCustDiffSelected[key]) return;
      const existing = map.get(key);
      if (existing) {
        existing.targetQty = formatQtyValue(item.quantity);
        if (!Number.isFinite(existing.unitPrice) && Number.isFinite(item.unitPrice)) {
          existing.unitPrice = item.unitPrice;
        }
        return;
      }
      map.set(key, {
        id: `cust-diff-target-${key}`,
        materialCode: item.materialCode || "",
        materialName: item.materialName || "",
        baseQty: "0",
        targetQty: formatQtyValue(item.quantity),
        itemId: item.itemId || "",
        unitPrice: Number.isFinite(item.unitPrice) ? item.unitPrice : undefined,
      });
    });
    return Array.from(map.values());
  };

  const applyCustDiffSelection = () => {
    const nextDiffItems = buildCustDiffItems();
    setFormData((prev) => ({
      ...prev,
      bomDiffItems: nextDiffItems,
    }));
    setBaseOnlyOrder(
      nextDiffItems.filter((item) => parseNumber(item.baseQty) > 0).map((item) => getDiffOrderKey(item))
    );
    setTargetOnlyOrder(
      nextDiffItems.filter((item) => parseNumber(item.targetQty) > 0).map((item) => getDiffOrderKey(item))
    );
    setUseCustDiffSelection(true);
  };

  const handleApplyCustDiffSelection = () => {
    applyCustDiffSelection();
    setIsCustDiffPickerOpen(false);
  };

  const renderCustDiffPicker = () => {
    if (formData.bomChangeType !== "replace" && formData.bomChangeType !== "materialAdjust") return null;
    if (!isCustDiffPickerOpen) return null;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
        <div className="w-full max-w-6xl rounded-2xl bg-[white] shadow-2xl flex flex-col max-h-[85vh]">
          <div className="flex items-center justify-between gap-3 border-b border-[#e8eaed] px-6 py-4">
            <div>
              <div className="text-lg font-semibold text-[#1f2329]">选择差异清单</div>
              <div className="text-sm text-[#8f959e]">从基础与目标BOM候选中勾选差异项</div>
            </div>
            <Button variant="ghost" size="icon" onClick={() => setIsCustDiffPickerOpen(false)}>
              <X className="h-5 w-5" />
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <div className="rounded-xl border border-[#e8eaed] bg-[white] shadow-sm">
                <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[#e8eaed] bg-[#f8f9fb]">
                  <div>
                    <div className="text-sm font-medium text-[#1f2329]">基础BOM差异候选</div>
                    <div className="text-xs text-[#8f959e]">从基础BOM编码加载候选物料后勾选差异项</div>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-[#8f959e]">
                    <span>已选 {selectedBaseCustDiffCount} 项</span>
                    <Button type="button" variant="ghost" size="sm" className="h-7" onClick={loadBaseCustDiffOptions}>
                      刷新
                    </Button>
                  </div>
                </div>
                <div className="px-4 py-3 border-b border-[#e8eaed] bg-[#f8f9fb]">
                  <div className="relative">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <Input
                      className="pl-9 bg-[#f8f9fb] h-9 text-sm"
                      placeholder="搜索物料编码或名称..."
                      value={baseCustDiffQuery}
                      onChange={(e) => setBaseCustDiffQuery(e.target.value)}
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs text-[#8f959e]">
                    <span>共 {baseCustDiffOptions.length} 项</span>
                    <span>
                      匹配 {filteredBaseCustDiffOptions.length} 项 · 显示{" "}
                      {visibleBaseCustDiffOptions.length} 项
                    </span>
                  </div>
                </div>
                {!baseBomNumber ? (
                  <div className="px-4 py-6 text-sm text-[#8f959e]">请先选择基础BOM</div>
                ) : baseCustDiffLoading ? (
                  <div className="px-4 py-6 text-sm text-[#8f959e]">正在加载候选物料...</div>
                ) : baseCustDiffError ? (
                  <div className="px-4 py-6 text-sm text-red-500">{baseCustDiffError}</div>
                ) : baseCustDiffOptions.length === 0 ? (
                  <div className="px-4 py-10 text-center text-[#8f959e]">
                    <Database className="h-10 w-10 mx-auto mb-3 opacity-30" />
                    <p>暂无候选物料</p>
                  </div>
                ) : filteredBaseCustDiffOptions.length === 0 ? (
                  <div className="px-4 py-10 text-center text-[#8f959e]">
                    <Search className="h-10 w-10 mx-auto mb-3 opacity-30" />
                    <p>未找到匹配物料</p>
                    <p className="text-xs mt-1">请尝试更换关键词搜索</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-[#f8f9fb] text-xs text-[#8f959e]">
                        <tr>
                          <th className="px-4 py-2 text-center font-medium">选择</th>
                          <th className="px-4 py-2 text-left font-medium">物料编码</th>
                          <th className="px-4 py-2 text-right font-medium">用量</th>
                          <th className="px-4 py-2 text-right font-medium">最新采购单价</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#e8eaed]">
                        {orderedVisibleBaseCustDiffOptionsByGroup.map((item) => {
                          const key = getCustDiffKey(item);
                          const level = getCustDiffLevel(item);
                          const hasChild = Boolean(baseCustDiffChildMap[key]);
                          const canToggle = hasChild;
                          const isExpanded = Boolean(baseCustDiffExpanded[key]);
                          const isUnmatched = isBaseCustDiffUnmatched(item);
                          return (
                            <tr
                              key={`cust-diff-base-${key}`}
                              onClick={() => toggleBaseCustDiffSelection(key)}
                              className={`cursor-pointer transition-colors hover:bg-[#f8f9fb] ${
                                isUnmatched ? "bg-emerald-50/70" : ""
                              }`}
                            >
                              <td className="px-4 py-2 text-center">
                                <input
                                  type="checkbox"
                                  checked={Boolean(baseCustDiffSelected[key])}
                                  onClick={(event) => event.stopPropagation()}
                                  onChange={() => toggleBaseCustDiffSelection(key)}
                                  className="h-4 w-4 accent-[#3370ff]"
                                />
                              </td>
                              <td className="px-4 py-2 font-mono text-[#1f2329]">
                                <div
                                  className="flex items-center"
                                  style={{ paddingLeft: `${getCustDiffIndent(item) * 12}px` }}
                                >
                                  {canToggle ? (
                                    <button
                                      type="button"
                                      className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-md border border-[#e8eaed] text-[#8f959e] hover:text-[#1f2329]"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        toggleBaseCustDiffExpanded(key);
                                      }}
                                    >
                                      {isExpanded ? (
                                        <ChevronDown className="h-3 w-3" />
                                      ) : (
                                        <ChevronRight className="h-3 w-3" />
                                      )}
                                    </button>
                                  ) : null}
                                  {level > 1 ? (
                                    <span className="mr-2 inline-flex items-center rounded-md border border-[#e8eaed] px-1.5 py-0.5 text-[10px] text-[#8f959e]">
                                      L{level}
                                    </span>
                                  ) : null}
                                  <span className="group relative inline-flex max-w-full items-center">
                                    <span className="truncate">{item.materialCode || "—"}</span>
                                    {item.materialName ? (
                                      <span className="pointer-events-none absolute left-0 top-full z-10 mt-2 w-max max-w-xs rounded-md border border-[#e8eaed] bg-[white] px-2 py-1 text-xs text-[#1f2329] shadow-lg opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                                        {item.materialName}
                                      </span>
                                    ) : null}
                                  </span>
                                </div>
                              </td>
                              <td className="px-4 py-2 text-right text-[#1f2329]">
                                {formatQtyValue(item.quantity)}
                              </td>
                              <td className="px-4 py-2 text-right text-[#1f2329]">
                                {item.unitPrice ? formatMoney(item.unitPrice) : "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              <div className="rounded-xl border border-[#e8eaed] bg-[white] shadow-sm">
                <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[#e8eaed] bg-[#f8f9fb]">
                  <div>
                    <div className="text-sm font-medium text-[#1f2329]">目标BOM差异候选</div>
                    <div className="text-xs text-[#8f959e]">从目标BOM编码加载候选物料后勾选差异项</div>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-[#8f959e]">
                    <span>已选 {selectedTargetCustDiffCount} 项</span>
                    <Button type="button" variant="ghost" size="sm" className="h-7" onClick={loadTargetCustDiffOptions}>
                      刷新
                    </Button>
                  </div>
                </div>
                <div className="px-4 py-3 border-b border-[#e8eaed] bg-[#f8f9fb]">
                  <div className="relative">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <Input
                      className="pl-9 bg-[#f8f9fb] h-9 text-sm"
                      placeholder="搜索物料编码或名称..."
                      value={targetCustDiffQuery}
                      onChange={(e) => setTargetCustDiffQuery(e.target.value)}
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs text-[#8f959e]">
                    <span>共 {targetCustDiffOptions.length} 项</span>
                    <span>
                      匹配 {filteredTargetCustDiffOptions.length} 项 · 显示{" "}
                      {visibleTargetCustDiffOptions.length} 项
                    </span>
                  </div>
                </div>
                {!targetBomNumber ? (
                  <div className="px-4 py-6 text-sm text-[#8f959e]">请先选择目标BOM</div>
                ) : targetCustDiffLoading ? (
                  <div className="px-4 py-6 text-sm text-[#8f959e]">正在加载候选物料...</div>
                ) : targetCustDiffError ? (
                  <div className="px-4 py-6 text-sm text-red-500">{targetCustDiffError}</div>
                ) : targetCustDiffOptions.length === 0 ? (
                  <div className="px-4 py-10 text-center text-[#8f959e]">
                    <Database className="h-10 w-10 mx-auto mb-3 opacity-30" />
                    <p>暂无候选物料</p>
                  </div>
                ) : filteredTargetCustDiffOptions.length === 0 ? (
                  <div className="px-4 py-10 text-center text-[#8f959e]">
                    <Search className="h-10 w-10 mx-auto mb-3 opacity-30" />
                    <p>未找到匹配物料</p>
                    <p className="text-xs mt-1">请尝试更换关键词搜索</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-[#f8f9fb] text-xs text-[#8f959e]">
                        <tr>
                          <th className="px-4 py-2 text-center font-medium">选择</th>
                          <th className="px-4 py-2 text-left font-medium">物料编码</th>
                          <th className="px-4 py-2 text-right font-medium">用量</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#e8eaed]">
                        {orderedVisibleTargetCustDiffOptionsByGroup.map((item) => {
                          const key = getCustDiffKey(item);
                          const level = getCustDiffLevel(item);
                          const hasChild = Boolean(targetCustDiffChildMap[key]);
                          const canToggle = hasChild;
                          const isExpanded = Boolean(targetCustDiffExpanded[key]);
                          const isUnmatched = isTargetCustDiffUnmatched(item);
                          return (
                            <tr
                              key={`cust-diff-target-${key}`}
                              onClick={() => toggleTargetCustDiffSelection(key)}
                              className={`cursor-pointer transition-colors hover:bg-[#f8f9fb] ${
                                isUnmatched ? "bg-sky-50/70" : ""
                              }`}
                            >
                              <td className="px-4 py-2 text-center">
                                <input
                                  type="checkbox"
                                  checked={Boolean(targetCustDiffSelected[key])}
                                  onClick={(event) => event.stopPropagation()}
                                  onChange={() => toggleTargetCustDiffSelection(key)}
                                  className="h-4 w-4 accent-[#3370ff]"
                                />
                              </td>
                              <td className="px-4 py-2 font-mono text-[#1f2329]">
                                <div
                                  className="flex items-center"
                                  style={{ paddingLeft: `${getCustDiffIndent(item) * 12}px` }}
                                >
                                  {canToggle ? (
                                    <button
                                      type="button"
                                      className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-md border border-[#e8eaed] text-[#8f959e] hover:text-[#1f2329]"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        toggleTargetCustDiffExpanded(key);
                                      }}
                                    >
                                      {isExpanded ? (
                                        <ChevronDown className="h-3 w-3" />
                                      ) : (
                                        <ChevronRight className="h-3 w-3" />
                                      )}
                                    </button>
                                  ) : null}
                                  {level > 1 ? (
                                    <span className="mr-2 inline-flex items-center rounded-md border border-[#e8eaed] px-1.5 py-0.5 text-[10px] text-[#8f959e]">
                                      L{level}
                                    </span>
                                  ) : null}
                                  <span className="group relative inline-flex max-w-full items-center">
                                    <span className="truncate">{item.materialCode || "—"}</span>
                                    {item.materialName ? (
                                      <span className="pointer-events-none absolute left-0 top-full z-10 mt-2 w-max max-w-xs rounded-md border border-[#e8eaed] bg-[white] px-2 py-1 text-xs text-[#1f2329] shadow-lg opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                                        {item.materialName}
                                      </span>
                                    ) : null}
                                  </span>
                                </div>
                              </td>
                              <td className="px-4 py-2 text-right text-[#1f2329]">
                                {formatQtyValue(item.quantity)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-[#e8eaed] px-6 py-4 bg-[#f8f9fb]">
            <div className="text-xs text-[#8f959e]">
              已选 基础 {selectedBaseCustDiffCount} 项 · 目标 {selectedTargetCustDiffCount} 项
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" size="sm" className="h-8" onClick={() => setIsCustDiffPickerOpen(false)}>
                取消
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-8"
                onClick={handleApplyCustDiffSelection}
                disabled={selectedBaseCustDiffCount === 0 && selectedTargetCustDiffCount === 0}
              >
                应用并关闭
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const updateAdjustmentItem = (
    id: string,
    field: keyof Omit<BomMaterialDraft, "id">,
    value: string
  ) => {
    setFormData((prev) => ({
      ...prev,
      bomMaterialAdjustments: (prev.bomMaterialAdjustments || []).map((item) =>
        item.id === id ? { ...item, [field]: value } : item
      ),
    }));
    if (field === "replaceFromCode" || field === "replaceFromName") {
      setRawReplaceBomMap((prev) => ({ ...prev, [id]: [] }));
      setRawReplaceBomError((prev) => ({ ...prev, [id]: "" }));
      setRawReplaceBomFolded((prev) => ({ ...prev, [id]: false }));
      setRawReplaceItemIdMap((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  const addAdjustmentItem = () => {
    const id = Math.random().toString(36).slice(2, 9);
    setFormData((prev) => ({
      ...prev,
      bomMaterialAdjustments: [
        ...(prev.bomMaterialAdjustments || []),
        {
          id,
          materialCode: "",
          materialName: "",
          oldPrice: "",
          newPrice: "",
          replaceFromCode: "",
          replaceFromName: "",
          replaceToCode: "",
          replaceToName: "",
        },
      ],
    }));
  };

  const removeAdjustmentItem = (id: string) => {
    setFormData((prev) => ({
      ...prev,
      bomMaterialAdjustments: (prev.bomMaterialAdjustments || []).filter((item) => item.id !== id),
    }));
    setRawReplaceBomMap((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setRawReplaceBomLoading((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setRawReplaceBomError((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setRawReplaceBomFolded((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setRawReplaceItemIdMap((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const toggleRawReplaceFold = (id: string) => {
    setRawReplaceBomFolded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const removeRawReplaceBom = (id: string, index: number) => {
    setRawReplaceBomMap((prev) => ({
      ...prev,
      [id]: (prev[id] || []).filter((_, itemIndex) => itemIndex !== index),
    }));
  };

  const parseNumber = (value: string) => {
    const next = Number(value);
    return Number.isFinite(next) ? next : 0;
  };

  const getDiffDelta = (item: BomDiffDraft) =>
    parseNumber(item.targetQty) - parseNumber(item.baseQty);
  const getDiffOrderKey = (item: BomDiffDraft) =>
    [item.itemId?.trim(), item.materialCode.trim(), item.materialName.trim()]
      .filter(Boolean)
      .join("::");
  const getCustDiffKey = useCallback(
    (item: BomMaterialItem) =>
      [item.itemId?.trim(), item.materialCode.trim(), item.materialName.trim()]
        .filter(Boolean)
        .join("::"),
    []
  );

  const normalizeCustDiffQuery = (value: string) => value.trim().toLowerCase();
  const matchesCustDiffQuery = (item: BomMaterialItem, keyword: string) => {
    if (!keyword) return true;
    return [item.materialCode, item.materialName, item.itemId, item.entryId].some((field) =>
      String(field || "").toLowerCase().includes(keyword)
    );
  };
  const getCustDiffLevel = useCallback((item: BomMaterialItem) => {
    const level = typeof item.level === "number" ? item.level : Number(item.level);
    if (Number.isFinite(level) && level > 0) return level;
    const path = typeof item.path === "string" ? item.path.trim() : "";
    if (path) {
      const segments = path.split(".").filter(Boolean);
      if (segments.length > 0) return segments.length;
    }
    if (item.parentId) return 2;
    return 1;
  }, []);
  const getCustDiffIndent = (item: BomMaterialItem) =>
    Math.min(Math.max(getCustDiffLevel(item) - 1, 0), 12);
  const buildCustDiffVisible = useCallback(
    (items: BomMaterialItem[], expanded: Record<string, boolean>): BomMaterialItem[] => {
      const visible: BomMaterialItem[] = [];
      const expandedAtLevel: Record<number, boolean> = {};
      items.forEach((item) => {
        const level = Math.max(getCustDiffLevel(item), 1);
        Object.keys(expandedAtLevel).forEach((key) => {
          const keyLevel = Number(key);
          if (Number.isFinite(keyLevel) && keyLevel >= level) {
            delete expandedAtLevel[keyLevel];
          }
        });
        let isVisible = level === 1;
        if (!isVisible) {
          for (let l = 1; l < level; l += 1) {
            if (!expandedAtLevel[l]) {
              isVisible = false;
              break;
            }
            isVisible = true;
          }
        }
        if (isVisible) {
          visible.push(item);
          const key = getCustDiffKey(item);
          expandedAtLevel[level] = Boolean(expanded[key]);
        }
      });
      return visible;
    },
    [getCustDiffLevel, getCustDiffKey]
  );

  const formatDelta = (value: number) => {
    const safe = Number.isFinite(value) ? value : 0;
    const sign = safe > 0 ? "+" : "";
    return `${sign}${safe.toFixed(2)}`;
  };
  const selectedBaseCustDiffCount = useMemo(
    () => Object.values(baseCustDiffSelected).filter(Boolean).length,
    [baseCustDiffSelected]
  );
  const selectedTargetCustDiffCount = useMemo(
    () => Object.values(targetCustDiffSelected).filter(Boolean).length,
    [targetCustDiffSelected]
  );
  const filteredBaseCustDiffOptions = useMemo(() => {
    const keyword = normalizeCustDiffQuery(baseCustDiffQuery);
    return baseCustDiffOptions.filter((item) => matchesCustDiffQuery(item, keyword));
  }, [baseCustDiffOptions, baseCustDiffQuery]);
  const filteredTargetCustDiffOptions = useMemo(() => {
    const keyword = normalizeCustDiffQuery(targetCustDiffQuery);
    return targetCustDiffOptions.filter((item) => matchesCustDiffQuery(item, keyword));
  }, [targetCustDiffOptions, targetCustDiffQuery]);
  const visibleBaseCustDiffOptions = useMemo(
    () => buildCustDiffVisible(filteredBaseCustDiffOptions, baseCustDiffExpanded),
    [filteredBaseCustDiffOptions, baseCustDiffExpanded, buildCustDiffVisible]
  );
  const visibleTargetCustDiffOptions = useMemo(
    () => buildCustDiffVisible(filteredTargetCustDiffOptions, targetCustDiffExpanded),
    [filteredTargetCustDiffOptions, targetCustDiffExpanded, buildCustDiffVisible]
  );
  const normalizeMaterialCode = useCallback((code: string) => code.trim().toLowerCase(), []);
  const getMaterialQty = useCallback((item: BomMaterialItem) => {
    const qty = Number(item.quantity);
    return Number.isFinite(qty) ? qty : 0;
  }, []);
  const getQtyBucketKey = useCallback(
    (item: BomMaterialItem) => {
      const code = normalizeMaterialCode(item.materialCode || "");
      if (!code) return "";
      return `${code}::${getMaterialQty(item)}`;
    },
    [normalizeMaterialCode, getMaterialQty]
  );
  const buildQtyBucketCount = useCallback(
    (items: BomMaterialItem[]) => {
      const map = new Map<string, number>();
      items.forEach((item) => {
        const bucket = getQtyBucketKey(item);
        if (!bucket) return;
        map.set(bucket, (map.get(bucket) || 0) + 1);
      });
      return map;
    },
    [getQtyBucketKey]
  );
  const buildQtyBucketOccurrence = useCallback(
    (items: BomMaterialItem[]) => {
      const counts = new Map<string, number>();
      const map = new Map<string, number>();
      items.forEach((item) => {
        const bucket = getQtyBucketKey(item);
        const key = getCustDiffKey(item);
        if (!bucket || !key) return;
        const next = (counts.get(bucket) || 0) + 1;
        counts.set(bucket, next);
        map.set(key, next);
      });
      return map;
    },
    [getQtyBucketKey, getCustDiffKey]
  );
  const baseCustDiffBucketCounts = useMemo(
    () => buildQtyBucketCount(baseCustDiffOptions),
    [baseCustDiffOptions, buildQtyBucketCount]
  );
  const targetCustDiffBucketCounts = useMemo(
    () => buildQtyBucketCount(targetCustDiffOptions),
    [targetCustDiffOptions, buildQtyBucketCount]
  );
  const baseCustDiffBucketOccurrences = useMemo(
    () => buildQtyBucketOccurrence(baseCustDiffOptions),
    [baseCustDiffOptions, buildQtyBucketOccurrence]
  );
  const targetCustDiffBucketOccurrences = useMemo(
    () => buildQtyBucketOccurrence(targetCustDiffOptions),
    [targetCustDiffOptions, buildQtyBucketOccurrence]
  );
  const isBaseCustDiffUnmatched = useCallback(
    (item: BomMaterialItem) => {
      const bucket = getQtyBucketKey(item);
      const key = getCustDiffKey(item);
      if (!bucket || !key) return true;
      const targetCount = targetCustDiffBucketCounts.get(bucket) || 0;
      if (targetCount === 0) return true;
      const occurrence = baseCustDiffBucketOccurrences.get(key) || 0;
      return occurrence > targetCount;
    },
    [getQtyBucketKey, getCustDiffKey, targetCustDiffBucketCounts, baseCustDiffBucketOccurrences]
  );
  const isTargetCustDiffUnmatched = useCallback(
    (item: BomMaterialItem) => {
      const bucket = getQtyBucketKey(item);
      const key = getCustDiffKey(item);
      if (!bucket || !key) return true;
      const baseCount = baseCustDiffBucketCounts.get(bucket) || 0;
      if (baseCount === 0) return true;
      const occurrence = targetCustDiffBucketOccurrences.get(key) || 0;
      return occurrence > baseCount;
    },
    [getQtyBucketKey, getCustDiffKey, baseCustDiffBucketCounts, targetCustDiffBucketOccurrences]
  );
  const reorderCustDiffByGroup = useCallback(
    (items: BomMaterialItem[], isUnmatched: (item: BomMaterialItem) => boolean) => {
      const groups: { items: BomMaterialItem[]; hasUnmatched: boolean }[] = [];
      let current: BomMaterialItem[] = [];
      let currentHasUnmatched = false;
      items.forEach((item, index) => {
        const level = Math.max(getCustDiffLevel(item), 1);
        if (level === 1 && current.length > 0) {
          groups.push({ items: current, hasUnmatched: currentHasUnmatched });
          current = [];
          currentHasUnmatched = false;
        }
        current.push(item);
        if (isUnmatched(item)) currentHasUnmatched = true;
        if (index === items.length - 1 && current.length > 0) {
          groups.push({ items: current, hasUnmatched: currentHasUnmatched });
        }
      });
      const mismatchedGroups = groups.filter((g) => g.hasUnmatched);
      const matchedGroups = groups.filter((g) => !g.hasUnmatched);
      return mismatchedGroups.concat(matchedGroups).flatMap((g) => g.items);
    },
    [getCustDiffLevel]
  );
  const orderedVisibleBaseCustDiffOptionsByGroup = useMemo(
    () => reorderCustDiffByGroup(visibleBaseCustDiffOptions, isBaseCustDiffUnmatched),
    [visibleBaseCustDiffOptions, isBaseCustDiffUnmatched, reorderCustDiffByGroup]
  );
  const orderedVisibleTargetCustDiffOptionsByGroup = useMemo(
    () => reorderCustDiffByGroup(visibleTargetCustDiffOptions, isTargetCustDiffUnmatched),
    [visibleTargetCustDiffOptions, isTargetCustDiffUnmatched, reorderCustDiffByGroup]
  );
  const buildCustDiffChildMap = useCallback(
    (items: BomMaterialItem[]) => {
      const map: Record<string, boolean> = {};
      items.forEach((item, index) => {
        const key = getCustDiffKey(item);
        const level = Math.max(getCustDiffLevel(item), 1);
        const nextItem = items[index + 1];
        if (!nextItem) {
          map[key] = false;
          return;
        }
        const nextLevel = Math.max(getCustDiffLevel(nextItem), 1);
        map[key] = nextLevel > level;
      });
      return map;
    },
    [getCustDiffKey, getCustDiffLevel]
  );
  const baseCustDiffChildMap = useMemo(
    () => buildCustDiffChildMap(filteredBaseCustDiffOptions),
    [filteredBaseCustDiffOptions, buildCustDiffChildMap]
  );
  const targetCustDiffChildMap = useMemo(
    () => buildCustDiffChildMap(filteredTargetCustDiffOptions),
    [filteredTargetCustDiffOptions, buildCustDiffChildMap]
  );
  const visibleDiffItems = useMemo(() => formData.bomDiffItems || [], [formData.bomDiffItems]);
  const diffGroups = useMemo(() => {
    const baseOnly: BomDiffDraft[] = [];
    const targetOnly: BomDiffDraft[] = [];
    const changed: BomDiffDraft[] = [];
    visibleDiffItems.forEach((item) => {
      const baseQty = parseNumber(item.baseQty);
      const targetQty = parseNumber(item.targetQty);
      if (baseQty > 0 && targetQty === 0) {
        baseOnly.push(item);
        return;
      }
      if (targetQty > 0 && baseQty === 0) {
        targetOnly.push(item);
        return;
      }
      changed.push(item);
    });
    return { baseOnly, targetOnly, changed };
  }, [visibleDiffItems]);

  const dragStateRef = useRef<{ group: "base" | "target" | null; id: string | null }>({
    group: null,
    id: null,
  });
  const [baseOnlyOrder, setBaseOnlyOrder] = useState<string[]>([]);
  const [targetOnlyOrder, setTargetOnlyOrder] = useState<string[]>([]);
  const orderedBaseOnly = useMemo(() => {
    const map = new Map(diffGroups.baseOnly.map((i) => [getDiffOrderKey(i), i]));
    const seen = new Set<string>();
    const ordered: BomDiffDraft[] = [];
    baseOnlyOrder.forEach((key) => {
      const item = map.get(key);
      if (!item || seen.has(key)) return;
      ordered.push(item);
      seen.add(key);
    });
    diffGroups.baseOnly.forEach((item) => {
      const key = getDiffOrderKey(item);
      if (seen.has(key)) return;
      ordered.push(item);
      seen.add(key);
    });
    return ordered;
  }, [diffGroups.baseOnly, baseOnlyOrder]);
  const orderedTargetOnly = useMemo(() => {
    const map = new Map(diffGroups.targetOnly.map((i) => [getDiffOrderKey(i), i]));
    const seen = new Set<string>();
    const ordered: BomDiffDraft[] = [];
    targetOnlyOrder.forEach((key) => {
      const item = map.get(key);
      if (!item || seen.has(key)) return;
      ordered.push(item);
      seen.add(key);
    });
    diffGroups.targetOnly.forEach((item) => {
      const key = getDiffOrderKey(item);
      if (seen.has(key)) return;
      ordered.push(item);
      seen.add(key);
    });
    return ordered;
  }, [diffGroups.targetOnly, targetOnlyOrder]);
  const onDragStart = (group: "base" | "target", id: string) => {
    dragStateRef.current = { group, id };
  };
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };
  const onDrop = (group: "base" | "target", targetId: string) => {
    const state = dragStateRef.current;
    if (!state.id || state.group !== group || state.id === targetId) return;
    const sourceId = state.id;
    if (group === "base") {
      setBaseOnlyOrder((prev) => {
        const seed = diffGroups.baseOnly.map((item) => getDiffOrderKey(item));
        const base = prev.length === seed.length ? prev : seed;
        const next = base.filter((id) => id !== sourceId);
        const idx = next.indexOf(targetId);
        next.splice(idx >= 0 ? idx : next.length, 0, sourceId);
        return next;
      });
    } else {
      setTargetOnlyOrder((prev) => {
        const seed = diffGroups.targetOnly.map((item) => getDiffOrderKey(item));
        const base = prev.length === seed.length ? prev : seed;
        const next = base.filter((id) => id !== sourceId);
        const idx = next.indexOf(targetId);
        next.splice(idx >= 0 ? idx : next.length, 0, sourceId);
        return next;
      });
    }
    dragStateRef.current = { group: null, id: null };
  };
  const onDragEnd = () => {
    dragStateRef.current = { group: null, id: null };
  };

  useEffect(() => {
    setDiffTraceMap({});
    setDiffTraceLoading({});
    setDiffTraceError({});
    setDiffTraceFolded({});
  }, [formData.bomChangeType, baseMaterials, targetMaterials]);

  useEffect(() => {
    if (formData.bomChangeType !== "materialAdjust") return;
    visibleDiffItems.forEach((item) => {
      const itemId = item.itemId?.trim();
      if (!itemId) return;
      if (Object.prototype.hasOwnProperty.call(diffTraceMap, item.id)) return;
      if (diffTraceLoading[item.id]) return;
      loadDiffTraceBoms(item.id, itemId);
    });
  }, [visibleDiffItems, formData.bomChangeType, diffTraceMap, diffTraceLoading, loadDiffTraceBoms]);
  const changeTypeClass = (type: BomChangeType) =>
    `h-9 px-4 rounded-full text-sm font-semibold transition-all ${
      formData.bomChangeType === type
        ? "bg-emerald-500 text-white shadow-md shadow-emerald-500/30"
        : "border border-[#e8eaed] text-[#8f959e] hover:text-[#1f2329] hover:bg-[#f8f9fb]"
    } ${canEditBom ? "" : "opacity-50 cursor-not-allowed"}`;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#f5f6f8] flex items-center justify-center text-[#8f959e]">
        正在加载...
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-[#f5f6f8] flex items-center justify-center text-[#8f959e]">
        {errorMessage || "正在跳转登录..."}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f5f6f8] pb-12 relative">
      <header className="bg-white border-b border-[#e8eaed] shadow-[0_1px_3px_rgba(31,35,41,0.05)] sticky top-0 z-20">
        <div className="container mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-[#3370ff] text-[white] p-1 rounded">
              <span className="font-bold text-lg">PM</span>
            </div>
            <span className="text-xl font-bold text-[#1f2329]">项目管理</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" className="gap-2" onClick={() => router.push("/")}>
              <Home className="h-4 w-4" />
              首页
            </Button>
            <Button variant="ghost" size="icon" onClick={() => router.back()}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto px-4 py-6">
        {errorMessage && (
          <div className="mb-6 rounded-lg px-4 py-3 text-sm bg-red-50 text-red-600 border border-red-200">
            {errorMessage}
          </div>
        )}

        <div className="max-w-none space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold text-[#1f2329]">BOM变更</h1>
              {selectedProjectId && (
                <span className="rounded-full border border-[#e8eaed] bg-[white] px-3 py-1 text-xs text-[#8f959e]">
                  已选项目 {projects.find((p) => p.id === selectedProjectId)?.name || selectedProjectId}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <Label className="text-[#8f959e]">选择项目</Label>
              <select
                className="h-10 rounded-md border border-[#e8eaed] bg-[#f8f9fb] px-3 text-sm text-[#1f2329]"
                value={selectedProjectId}
                onChange={(e) => handleProjectSelect(e.target.value)}
              >
                <option value="">未选择</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <Button
                type="submit"
                form="project-create-form"
                className="h-11 px-6 gap-2 bg-emerald-600 hover:bg-emerald-700 text-white shadow-md hover:shadow-lg transition-all"
                disabled={!selectedProjectId || isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    保存中...
                  </>
                ) : (
                  <>
                    保存到项目
                  </>
                )}
              </Button>
            </div>
          </div>
          <form id="project-create-form" onSubmit={handleSubmit} className="space-y-6">

            <div className="bg-white rounded-xl border border-[#e8eaed] p-0 overflow-hidden">
              <div className="border-b border-[#e8eaed] bg-[#f8f9fb] px-6">
                <div className="flex items-center justify-between gap-3 h-14">
                  <div className="flex items-center gap-8">
                    <button
                      type="button"
                      className={`text-sm font-semibold ${mainTab === "basic" ? "text-emerald-600" : "text-[#8f959e]"}`}
                      onClick={() => setMainTab("basic")}
                    >
                      项目基本信息
                      <span className={`block h-[3px] rounded-t-full ${mainTab === "basic" ? "bg-emerald-500" : "bg-transparent"}`}></span>
                    </button>
                    <button
                      type="button"
                      className={`text-sm font-semibold ${mainTab === "plan" ? "text-emerald-600" : "text-[#8f959e]"}`}
                      onClick={() => setMainTab("plan")}
                    >
                      BOM变更方案
                      <span className={`block h-[3px] rounded-t-full ${mainTab === "plan" ? "bg-emerald-500" : "bg-transparent"}`}></span>
                    </button>
                    <button
                      type="button"
                      className={`text-sm font-semibold ${mainTab === "cost" ? "text-emerald-600" : "text-[#8f959e]"}`}
                      onClick={() => setMainTab("cost")}
                    >
                      费用关联模拟
                      <span className={`block h-[3px] rounded-t-full ${mainTab === "cost" ? "bg-emerald-500" : "bg-transparent"}`}></span>
                    </button>
                  </div>
                  {mainTab === "plan" && (
                    <div className="flex items-center gap-2">
                      <button type="button" disabled={!canEditBom} className={changeTypeClass("materialAdjust")} onClick={() => updateBomChangeType("materialAdjust")}>
                        客户BOM替换
                      </button>
                      <button type="button" disabled={!canEditBom} className={changeTypeClass("replace")} onClick={() => updateBomChangeType("replace")}>
                        产品替换
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <div className="p-5">
                {mainTab === "basic" ? (
                  <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <div className="rounded-2xl border border-[#e8eaed] bg-[white] p-5 space-y-4">
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div className="space-y-1">
                          <Label className="text-[#8f959e]">立项表</Label>
                          <div className="text-sm text-[#1f2329]">
                            {selectedProjectForm?.name || "未选择立项表"}
                          </div>
                          {selectedProjectForm && (
                            <div className="text-xs text-[#8f959e]">
                              {selectedProjectForm.code ? `编号 ${selectedProjectForm.code}` : ""}
                              {selectedProjectForm.createdAt ? ` · ${selectedProjectForm.createdAt}` : ""}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant="ghost"
                            className="h-9"
                            onClick={handleClearProjectForm}
                            disabled={!selectedProjectForm}
                          >
                            清除
                          </Button>
                          <Button
                            type="button"
                            className="h-9"
                            onClick={() => {
                              setProjectFormQuery("");
                              setIsProjectFormModalOpen(true);
                            }}
                            disabled={!canEditBasic}
                          >
                            选择立项表
                          </Button>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label className="text-[#8f959e]">项目编号</Label>
                          <Input value={selectedProjectId || ""} disabled />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-[#8f959e]">项目名称</Label>
                          <Input
                            value={basicInfo.name}
                            onChange={(e) => setBasicInfo((prev) => ({ ...prev, name: e.target.value }))}
                            placeholder="请输入项目名称"
                            disabled={!canEditBasic}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-[#8f959e]">发起人</Label>
                          <Input
                            value={basicInfo.initiator}
                            onChange={(e) => setBasicInfo((prev) => ({ ...prev, initiator: e.target.value }))}
                            placeholder="请输入发起人"
                            disabled={!canEditBasic}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-[#8f959e]">项目周期</Label>
                          <Input
                            value={basicInfo.cycle}
                            onChange={(e) => setBasicInfo((prev) => ({ ...prev, cycle: e.target.value }))}
                            placeholder="起止日期或周期"
                            disabled={!canEditBasic}
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 gap-4">
                        <div className="space-y-2">
                          <Label className="text-[#8f959e]">问题描述 / 机会点</Label>
                          <Textarea
                            value={basicInfo.problem}
                            onChange={(e) => setBasicInfo((prev) => ({ ...prev, problem: e.target.value }))}
                            placeholder="请输入问题描述或机会点"
                            disabled={!canEditBasic}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-[#8f959e]">项目目标（SMART）</Label>
                          <Textarea
                            value={basicInfo.goal}
                            onChange={(e) => setBasicInfo((prev) => ({ ...prev, goal: e.target.value }))}
                            placeholder="请输入项目目标"
                            disabled={!canEditBasic}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-[#8f959e]">主要行动措施</Label>
                          <Textarea
                            value={basicInfo.actions}
                            onChange={(e) => setBasicInfo((prev) => ({ ...prev, actions: e.target.value }))}
                            placeholder="请输入主要行动措施"
                            disabled={!canEditBasic}
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label className="text-[#8f959e]">资源需求</Label>
                          <Input
                            value={basicInfo.resources}
                            onChange={(e) => setBasicInfo((prev) => ({ ...prev, resources: e.target.value }))}
                            placeholder="请输入资源需求"
                            disabled={!canEditBasic}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-[#8f959e]">效益测算</Label>
                          <Input
                            value={basicInfo.benefit}
                            onChange={(e) => setBasicInfo((prev) => ({ ...prev, benefit: e.target.value }))}
                            placeholder="请输入效益测算"
                            disabled={!canEditBasic}
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 gap-4">
                        <div className="space-y-2">
                          <Label className="text-[#8f959e]">审批意见</Label>
                          <Input
                            value={basicInfo.approval}
                            onChange={(e) => setBasicInfo((prev) => ({ ...prev, approval: e.target.value }))}
                            placeholder="请输入审批意见"
                            disabled={!canEditBasic}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ) : mainTab === "plan" ? (
                  <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    {formData.bomChangeType === "replace" && (
                      <>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {/* Base BOM Selector */}
                      <div className="rounded-2xl border border-[#e8eaed] bg-[#f8f9fb] p-4 space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-1">
                            <div className="text-sm font-medium text-[#1f2329]">基础 BOM</div>
                            <div className="text-xs text-[#8f959e]">作为基准物料清单</div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              type="button"
                              variant={formData.formTemplateId ? "outline" : "default"}
                              className={formData.formTemplateId ? "" : "bg-emerald-600 hover:bg-emerald-700 text-white"}
                              onClick={() => {
                                if (!canEditBom) return;
                                setBomSelectMode("base");
                                setIsModalOpen(true);
                              }}
                              disabled={!canEditBom}
                            >
                              {formData.formTemplateId ? "更换 BOM" : "选择 BOM"}
                            </Button>
                            {formData.formTemplateId && (
                              <Button
                                type="button"
                                variant="ghost"
                                className="text-slate-400 hover:text-red-500"
                                onClick={handleClearSelection}
                                disabled={!canEditBom}
                              >
                                清空
                              </Button>
                            )}
                          </div>
                        </div>
                        {formData.formTemplateId ? (
                          <div className="space-y-2">
                            <div className="text-sm font-semibold text-[#1f2329] truncate">
                              {selectedTemplate?.name || "已选择 BOM"}
                            </div>
                            <div className="flex flex-wrap items-center gap-2 text-xs text-[#8f959e]">
                              <span className="font-mono bg-white/70 px-2 py-0.5 rounded">
                                BOM编码 {selectedTemplate?.bomNumber || formData.bomCode || selectedTemplate?.code || "—"}
                              </span>
                              <span className="rounded-full border border-[#e8eaed] bg-[white] px-2 py-0.5">
                                编码 {selectedTemplate?.code || "—"}
                              </span>
                              <span className="rounded-full border border-[#e8eaed] bg-[white] px-2 py-0.5">
                                日期 {selectedTemplate?.createdAt || "—"}
                              </span>
                            </div>
                            <div className="rounded-lg border border-[#e8eaed] bg-[white]">
                              <div className="flex items-center justify-between px-3 py-2 text-xs text-[#1f2329]">
                                <span>基础BOM明细（{sortedBaseMaterials.length}）</span>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2"
                                  onClick={() => setIsBaseBomDetailOpen((prev) => !prev)}
                                >
                                  {isBaseBomDetailOpen ? (
                                    <>
                                      <ChevronDown className="h-3.5 w-3.5" />
                                      收起
                                    </>
                                  ) : (
                                    <>
                                      <ChevronRight className="h-3.5 w-3.5" />
                                      展开
                                    </>
                                  )}
                                </Button>
                              </div>
                              {isBaseBomDetailOpen && (
                                <div className="overflow-x-auto border-t border-[#e8eaed]">
                                  <table className="w-full text-xs">
                                    <thead className="bg-[#f8f9fb] text-[#8f959e]">
                                      <tr>
                                        <th className="px-3 py-2 text-left font-medium">序号</th>
                                        <th className="px-3 py-2 text-left font-medium">物料编码</th>
                                        <th className="px-3 py-2 text-left font-medium">物料名称</th>
                                        <th className="px-3 py-2 text-right font-medium">用量</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[#e8eaed]">
                                      {sortedBaseMaterials.length > 0 ? (
                                        sortedBaseMaterials.map((item, index) => (
                                          <tr key={`base-${item.entryId}-${item.materialCode}`}>
                                            <td className="px-3 py-2 text-[#8f959e]">{index + 1}</td>
                                            <td className="px-3 py-2 font-mono">{item.materialCode || "—"}</td>
                                            <td className="px-3 py-2">{item.materialName || "—"}</td>
                                            <td className="px-3 py-2 text-right">{formatQtyValue(item.quantity)}</td>
                                          </tr>
                                        ))
                                      ) : (
                                        <tr>
                                          <td colSpan={4} className="px-3 py-4 text-center text-[#8f959e]">
                                            暂无明细
                                          </td>
                                        </tr>
                                      )}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="text-xs text-[#8f959e]">未关联 BOM</div>
                        )}
                      </div>

                      {/* Target BOM Selector */}
                      <div className="rounded-2xl border border-[#e8eaed] bg-[#f8f9fb] p-4 space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-1">
                            <div className="text-sm font-medium text-[#1f2329]">目标 BOM</div>
                            <div className="text-xs text-[#8f959e]">对比目标与影响范围</div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              type="button"
                              variant={formData.bomTargetId ? "outline" : "default"}
                              className={formData.bomTargetId ? "" : "bg-emerald-600 hover:bg-emerald-700 text-white"}
                              onClick={() => {
                                if (!canEditBom) return;
                                setBomSelectMode("target");
                                setIsModalOpen(true);
                              }}
                              disabled={!canEditBom}
                            >
                              {formData.bomTargetId ? "更换 BOM" : "选择 BOM"}
                            </Button>
                            {formData.bomTargetId && (
                              <Button
                                type="button"
                                variant="ghost"
                                className="text-slate-400 hover:text-red-500"
                                onClick={handleClearTargetSelection}
                                disabled={!canEditBom}
                              >
                                清空
                              </Button>
                            )}
                          </div>
                        </div>
                        {formData.bomTargetId ? (
                          <div className="space-y-2">
                            <div className="text-sm font-semibold text-[#1f2329] truncate">
                              {selectedTargetTemplate?.name || "已选择 BOM"}
                            </div>
                            <div className="flex flex-wrap items-center gap-2 text-xs text-[#8f959e]">
                              <span className="font-mono bg-white/70 px-2 py-0.5 rounded">
                                BOM编码 {selectedTargetTemplate?.bomNumber || formData.bomTargetCode || selectedTargetTemplate?.code || "—"}
                              </span>
                              <span className="rounded-full border border-[#e8eaed] bg-[white] px-2 py-0.5">
                                编码 {selectedTargetTemplate?.code || "—"}
                              </span>
                              <span className="rounded-full border border-[#e8eaed] bg-[white] px-2 py-0.5">
                                日期 {selectedTargetTemplate?.createdAt || "—"}
                              </span>
                            </div>
                            <div className="rounded-lg border border-[#e8eaed] bg-[white]">
                              <div className="flex items-center justify-between px-3 py-2 text-xs text-[#1f2329]">
                                <span>目标BOM明细（{sortedTargetMaterials.length}）</span>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2"
                                  onClick={() => setIsTargetBomDetailOpen((prev) => !prev)}
                                >
                                  {isTargetBomDetailOpen ? (
                                    <>
                                      <ChevronDown className="h-3.5 w-3.5" />
                                      收起
                                    </>
                                  ) : (
                                    <>
                                      <ChevronRight className="h-3.5 w-3.5" />
                                      展开
                                    </>
                                  )}
                                </Button>
                              </div>
                              {isTargetBomDetailOpen && (
                                <div className="overflow-x-auto border-t border-[#e8eaed]">
                                  <table className="w-full text-xs">
                                    <thead className="bg-[#f8f9fb] text-[#8f959e]">
                                      <tr>
                                        <th className="px-3 py-2 text-left font-medium">序号</th>
                                        <th className="px-3 py-2 text-left font-medium">物料编码</th>
                                        <th className="px-3 py-2 text-left font-medium">物料名称</th>
                                        <th className="px-3 py-2 text-right font-medium">用量</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[#e8eaed]">
                                      {sortedTargetMaterials.length > 0 ? (
                                        sortedTargetMaterials.map((item, index) => (
                                          <tr key={`target-${item.entryId}-${item.materialCode}`}>
                                            <td className="px-3 py-2 text-[#8f959e]">{index + 1}</td>
                                            <td className="px-3 py-2 font-mono">{item.materialCode || "—"}</td>
                                            <td className="px-3 py-2">{item.materialName || "—"}</td>
                                            <td className="px-3 py-2 text-right">{formatQtyValue(item.quantity)}</td>
                                          </tr>
                                        ))
                                      ) : (
                                        <tr>
                                          <td colSpan={4} className="px-3 py-4 text-center text-[#8f959e]">
                                            暂无明细
                                          </td>
                                        </tr>
                                      )}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="text-xs text-[#8f959e]">未选择目标 BOM</div>
                        )}
                      </div>
                    </div>


                    {/* Diff List */}
                    <div className="rounded-xl border border-[#e8eaed] overflow-hidden bg-[white]">
                      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-[#e8eaed] bg-[#f8f9fb]">
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 text-[#1f2329]"
                            onClick={() => setIsDiffOpen((prev) => !prev)}
                          >
                            {isDiffOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            {isDiffOpen ? "收起" : "展开"}
                          </Button>
                          <div className="text-sm font-medium text-[#1f2329]">差异清单</div>
                        </div>
                        {canUseCustDiffSelection && (
                          <div className="flex items-center gap-2 text-xs text-[#8f959e]">
                            <span>
                              基础 {selectedBaseCustDiffCount} · 目标 {selectedTargetCustDiffCount}
                            </span>
                            <Button
                              type="button"
                              size="sm"
                              className="h-7"
                              onClick={() => setIsCustDiffPickerOpen(true)}
                            >
                              选择差异
                            </Button>
                          </div>
                        )}
                      </div>
                      {isDiffOpen && (
                        <div className="p-4 space-y-4">
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                            <div className="rounded-xl border border-[#e8eaed] overflow-hidden bg-[white]">
                              <div className="px-4 py-3 border-b border-[#e8eaed] bg-[#f8f9fb]">
                                <div className="text-xs uppercase tracking-wide text-[#8f959e]">
                                  旧BOM有 / 新BOM无
                                </div>
                                <div className="text-base font-semibold text-[#1f2329]">
                                  {diffGroups.baseOnly.length} 项
                                </div>
                              </div>
                              {orderedBaseOnly.length > 0 ? (
                                <div className="overflow-x-auto">
                                  <table className="w-full text-sm">
                                    <thead className="bg-[#f8f9fb] text-xs text-[#8f959e]">
                                      <tr>
                                        <th className="px-4 py-2 text-left font-medium">物料编码</th>
                                        <th className="px-4 py-2 text-left font-medium">物料名称</th>
                                        <th className="px-4 py-2 text-left font-medium">用量</th>
                                        <th className="px-4 py-2 text-center font-medium"></th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[#e8eaed]">
                                      {orderedBaseOnly.map((item) => {
                                        const traceItems = diffTraceMap[item.id] || [];
                                        const traceLoading = diffTraceLoading[item.id];
                                        const traceError = diffTraceError[item.id];
                                        const traceFolded = diffTraceFolded[item.id];
                                        const hasTraceKey = Object.prototype.hasOwnProperty.call(diffTraceMap, item.id);
                                        const hasItemId = Boolean(item.itemId?.trim());
                                        const showTrace = hasItemId || traceLoading || Boolean(traceError) || hasTraceKey;
                                        const diffKey = getDiffOrderKey(item);
                                        return (
                                          <Fragment key={item.id}>
                                            <tr
                                              className="bg-[white]"
                                              draggable
                                              onDragStart={() => onDragStart("base", diffKey)}
                                              onDragOver={onDragOver}
                                              onDrop={() => onDrop("base", diffKey)}
                                              onDragEnd={onDragEnd}
                                            >
                                              <td className="px-4 py-2">
                                                <span className="text-sm text-[#1f2329] font-mono">
                                                  {item.materialCode || "—"}
                                                </span>
                                              </td>
                                              <td className="px-4 py-2">
                                                <span className="text-sm text-[#1f2329]">
                                                  {item.materialName || "—"}
                                                </span>
                                              </td>
                                              <td className="px-4 py-2">
                                                <span className="text-sm text-[#1f2329]">
                                                  {item.baseQty || "0"}
                                                </span>
                                              </td>
                                              <td className="px-4 py-2 text-right">
                                                <span className="text-sm text-[#1f2329]">
                                                  {item.unitPrice ? formatMoney(item.unitPrice) : "—"}
                                                </span>
                                              </td>
                                              <td className="px-4 py-2">
                                                <span className="inline-flex items-center justify-center w-8 h-8 rounded-full border border-[#e8eaed] bg-gradient-to-br from-[white] to-[#f8f9fb] text-[#8f959e] shadow-sm">
                                                  <GripVertical className="h-4 w-4" />
                                                </span>
                                              </td>
                                            </tr>
                                          {showTrace && (
                                            <tr className="bg-[white]">
                                              <td colSpan={6} className="px-4 pb-4">
                                                <div className="rounded-lg border border-[#e8eaed] bg-[#f8f9fb]">
                                                  <div className="flex items-center justify-between px-3 py-2 text-xs text-[#8f959e]">
                                                    <span>关联BOM</span>
                                                    <div className="flex items-center gap-2">
                                                      <span>共 {traceItems.length} 条</span>
                                                      <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="sm"
                                                        className="h-7"
                                                        onClick={() => item.itemId && loadDiffTraceBoms(item.id, item.itemId)}
                                                        disabled={!item.itemId || traceLoading}
                                                      >
                                                        {hasTraceKey ? "刷新" : "获取"}
                                                      </Button>
                                                      <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-7"
                                                        onClick={() =>
                                                          setDiffTraceFolded((prev) => ({ ...prev, [item.id]: !prev[item.id] }))
                                                        }
                                                        disabled={!hasTraceKey}
                                                      >
                                                        {traceFolded ? (
                                                          <>
                                                            <ChevronRight className="h-3.5 w-3.5" />
                                                            展开
                                                          </>
                                                        ) : (
                                                          <>
                                                            <ChevronDown className="h-3.5 w-3.5" />
                                                            折叠
                                                          </>
                                                        )}
                                                      </Button>
                                                    </div>
                                                  </div>
                                                  {traceLoading ? (
                                                    <div className="px-3 py-3 text-xs text-[#8f959e]">正在加载...</div>
                                                  ) : traceError ? (
                                                    <div className="px-3 py-3 text-xs text-red-500">{traceError}</div>
                                                  ) : traceItems.length > 0 ? (
                                                    !traceFolded && (
                                                      <div className="overflow-x-auto border-t border-[#e8eaed]">
                                                        <table className="w-full text-xs">
                                                          <thead className="bg-[white] text-[#8f959e]">
                                                            <tr>
                                                              <th className="px-3 py-2 text-left font-medium">BOM编号</th>
                                                              <th className="px-3 py-2 text-left font-medium">BOM代码</th>
                                                              <th className="px-3 py-2 text-left font-medium">BOM名称</th>
                                                              <th className="px-3 py-2 text-right font-medium">用量</th>
                                                              <th className="px-3 py-2 text-left font-medium">审核日期</th>
                                                            </tr>
                                                          </thead>
                                                          <tbody className="divide-y divide-[#e8eaed]">
                                                            {traceItems.map((trace, traceIndex) => (
                                                              <tr key={`${trace.bomNumber || trace.bomCode}-${traceIndex}`}>
                                                                <td className="px-3 py-2">
                                                                  <span className="text-[#1f2329] font-mono">
                                                                    {trace.bomNumber || "—"}
                                                                  </span>
                                                                </td>
                                                                <td className="px-3 py-2">
                                                                  <span className="text-[#1f2329]">
                                                                    {trace.bomCode || "—"}
                                                                  </span>
                                                                </td>
                                                                <td className="px-3 py-2">
                                                                  <span className="text-[#1f2329]">
                                                                    {trace.bomName || "—"}
                                                                  </span>
                                                                </td>
                                                                <td className="px-3 py-2 text-right">
                                                                  <span className="text-[#1f2329]">
                                                                    {formatQtyValue(trace.auxQty || 0)}
                                                                  </span>
                                                                </td>
                                                                <td className="px-3 py-2">
                                                                  <span className="text-[#1f2329]">
                                                                    {formatDateValue(trace.audDate)}
                                                                  </span>
                                                                </td>
                                                              </tr>
                                                            ))}
                                                          </tbody>
                                                        </table>
                                                      </div>
                                                    )
                                                  ) : (
                                                    <div className="px-3 py-3 text-xs text-[#8f959e]">未找到关联BOM</div>
                                                  )}
                                                </div>
                                              </td>
                                            </tr>
                                          )}
                                          </Fragment>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              ) : (
                                <div className="px-3 py-4 text-center text-xs text-[#8f959e]">暂无明细</div>
                              )}
                            </div>
                            <div className="rounded-xl border border-[#e8eaed] overflow-hidden bg-[white]">
                              <div className="px-4 py-3 border-b border-[#e8eaed] bg-[#f8f9fb]">
                                <div className="text-xs uppercase tracking-wide text-[#8f959e]">
                                  新BOM有 / 旧BOM无
                                </div>
                                <div className="text-base font-semibold text-[#1f2329]">
                                  {diffGroups.targetOnly.length} 项
                                </div>
                              </div>
                              {orderedTargetOnly.length > 0 ? (
                                <div className="overflow-x-auto">
                                  <table className="w-full text-sm">
                                    <thead className="bg-[#f8f9fb] text-xs text-[#8f959e]">
                                      <tr>
                                        <th className="px-4 py-2 text-left font-medium">物料编码</th>
                                        <th className="px-4 py-2 text-left font-medium">物料名称</th>
                                        <th className="px-4 py-2 text-left font-medium">用量</th>
                                        <th className="px-4 py-2 text-right font-medium">最新采购单价</th>
                                        <th className="px-4 py-2 text-center font-medium"></th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[#e8eaed]">
                                      {orderedTargetOnly.map((item) => {
                                        const traceItems = diffTraceMap[item.id] || [];
                                        const traceLoading = diffTraceLoading[item.id];
                                        const traceError = diffTraceError[item.id];
                                        const traceFolded = diffTraceFolded[item.id];
                                        const hasTraceKey = Object.prototype.hasOwnProperty.call(diffTraceMap, item.id);
                                        const diffKey = getDiffOrderKey(item);
                                        return (
                                          <Fragment key={item.id}>
                                            <tr
                                              className="bg-[white]"
                                              draggable
                                              onDragStart={() => onDragStart("target", diffKey)}
                                              onDragOver={onDragOver}
                                              onDrop={() => onDrop("target", diffKey)}
                                              onDragEnd={onDragEnd}
                                            >
                                              <td className="px-4 py-2">
                                                <span className="text-sm text-[#1f2329] font-mono">
                                                  {item.materialCode || "—"}
                                                </span>
                                              </td>
                                              <td className="px-4 py-2">
                                                <span className="text-sm text-[#1f2329]">
                                                  {item.materialName || "—"}
                                                </span>
                                              </td>
                                              <td className="px-4 py-2">
                                                <span className="text-sm text-[#1f2329]">
                                                  {item.targetQty || "0"}
                                                </span>
                                              </td>
                                              <td className="px-4 py-2 text-right">
                                                <span className="text-sm text-[#1f2329]">
                                                  {item.unitPrice ? formatMoney(item.unitPrice) : "—"}
                                                </span>
                                              </td>
                                              <td className="px-4 py-2">
                                                <span className="inline-flex items-center justify-center w-8 h-8 rounded-full border border-[#e8eaed] bg-gradient-to-br from-[white] to-[#f8f9fb] text-[#8f959e] shadow-sm">
                                                  <GripVertical className="h-4 w-4" />
                                                </span>
                                              </td>
                                            </tr>
                                            <tr className="bg-[white]">
                                              <td colSpan={5} className="px-4 pb-4">
                                                <div className="rounded-lg border border-[#e8eaed] bg-[#f8f9fb]">
                                                  <div className="flex items-center justify-between px-3 py-2 text-xs text-[#8f959e]">
                                                    <span>关联BOM</span>
                                                    <div className="flex items-center gap-2">
                                                      <span>共 {traceItems.length} 条</span>
                                                      <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="sm"
                                                        className="h-7"
                                                        onClick={() => item.itemId && loadDiffTraceBoms(item.id, item.itemId)}
                                                        disabled={!item.itemId || traceLoading}
                                                      >
                                                        {hasTraceKey ? "刷新" : "获取"}
                                                      </Button>
                                                      <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-7"
                                                        onClick={() =>
                                                          setDiffTraceFolded((prev) => ({ ...prev, [item.id]: !prev[item.id] }))
                                                        }
                                                        disabled={!hasTraceKey}
                                                      >
                                                        {traceFolded ? (
                                                          <>
                                                            <ChevronRight className="h-3.5 w-3.5" />
                                                            展开
                                                          </>
                                                        ) : (
                                                          <>
                                                            <ChevronDown className="h-3.5 w-3.5" />
                                                            折叠
                                                          </>
                                                        )}
                                                      </Button>
                                                    </div>
                                                  </div>
                                                  {traceLoading ? (
                                                    <div className="px-3 py-3 text-xs text-[#8f959e]">正在加载...</div>
                                                  ) : traceError ? (
                                                    <div className="px-3 py-3 text-xs text-red-500">{traceError}</div>
                                                  ) : traceItems.length > 0 ? (
                                                    !traceFolded && (
                                                      <div className="overflow-x-auto border-t border-[#e8eaed]">
                                                        <table className="w-full text-xs">
                                                          <thead className="bg-[white] text-[#8f959e]">
                                                            <tr>
                                                              <th className="px-3 py-2 text-left font-medium">BOM编号</th>
                                                              <th className="px-3 py-2 text-left font-medium">BOM代码</th>
                                                              <th className="px-3 py-2 text-left font-medium">BOM名称</th>
                                                              <th className="px-3 py-2 text-right font-medium">用量</th>
                                                              <th className="px-3 py-2 text-left font-medium">审核日期</th>
                                                            </tr>
                                                          </thead>
                                                          <tbody className="divide-y divide-[#e8eaed]">
                                                            {traceItems.map((trace, traceIndex) => (
                                                              <tr key={`${trace.bomNumber || trace.bomCode}-${traceIndex}`}>
                                                                <td className="px-3 py-2">
                                                                  <span className="text-[#1f2329] font-mono">
                                                                    {trace.bomNumber || "—"}
                                                                  </span>
                                                                </td>
                                                                <td className="px-3 py-2">
                                                                  <span className="text-[#1f2329]">
                                                                    {trace.bomCode || "—"}
                                                                  </span>
                                                                </td>
                                                                <td className="px-3 py-2">
                                                                  <span className="text-[#1f2329]">
                                                                    {trace.bomName || "—"}
                                                                  </span>
                                                                </td>
                                                                <td className="px-3 py-2 text-right">
                                                                  <span className="text-[#1f2329]">
                                                                    {formatQtyValue(trace.auxQty || 0)}
                                                                  </span>
                                                                </td>
                                                                <td className="px-3 py-2">
                                                                  <span className="text-[#1f2329]">
                                                                    {formatDateValue(trace.audDate)}
                                                                  </span>
                                                                </td>
                                                              </tr>
                                                            ))}
                                                          </tbody>
                                                        </table>
                                                      </div>
                                                    )
                                                  ) : (
                                                    <div className="px-3 py-3 text-xs text-[#8f959e]">未找到关联BOM</div>
                                                  )}
                                                </div>
                                              </td>
                                            </tr>
                                          </Fragment>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              ) : (
                                <div className="px-3 py-4 text-center text-xs text-[#8f959e]">暂无明细</div>
                              )}
                            </div>
                          </div>
                          <div className="rounded-xl border border-[#e8eaed] overflow-hidden bg-[white]">
                            <div className="px-4 py-3 border-b border-[#e8eaed] bg-[#f8f9fb]">
                              <div className="text-xs uppercase tracking-wide text-[#8f959e]">用量变化</div>
                              <div className="text-base font-semibold text-[#1f2329]">
                                {diffGroups.changed.length} 项
                              </div>
                            </div>
                            {diffGroups.changed.length > 0 ? (
                              <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                  <thead className="bg-[#f8f9fb] text-xs text-[#8f959e]">
                                    <tr>
                                      <th className="px-4 py-2 text-left font-medium">物料编码</th>
                                      <th className="px-4 py-2 text-left font-medium">物料名称</th>
                                      <th className="px-4 py-2 text-left font-medium">旧BOM用量</th>
                                      <th className="px-4 py-2 text-left font-medium">新BOM用量</th>
                                      <th className="px-4 py-2 text-right font-medium">最新采购单价</th>
                                      <th className="px-4 py-2 text-left font-medium">差异</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-[#e8eaed]">
                                    {diffGroups.changed.map((item) => {
                                      const traceItems = diffTraceMap[item.id] || [];
                                      const traceLoading = diffTraceLoading[item.id];
                                      const traceError = diffTraceError[item.id];
                                      const traceFolded = diffTraceFolded[item.id];
                                      const hasTraceKey = Object.prototype.hasOwnProperty.call(diffTraceMap, item.id);
                                      const hasItemId = Boolean(item.itemId?.trim());
                                      const showTrace = hasItemId || traceLoading || Boolean(traceError) || hasTraceKey;
                                      return (
                                        <Fragment key={item.id}>
                                          <tr className="bg-[white]">
                                            <td className="px-4 py-2">
                                              <span className="text-sm text-[#1f2329]">
                                                {item.materialCode || "—"}
                                              </span>
                                            </td>
                                            <td className="px-4 py-2">
                                              <span className="text-sm text-[#1f2329]">
                                                {item.materialName || "—"}
                                              </span>
                                            </td>
                                            <td className="px-4 py-2">
                                              <span className="text-sm text-[#1f2329]">
                                                {item.baseQty || "0"}
                                              </span>
                                            </td>
                                            <td className="px-4 py-2">
                                              <span className="text-sm text-[#1f2329]">
                                                {item.targetQty || "0"}
                                              </span>
                                            </td>
                                            <td className="px-4 py-2 text-right">
                                              <span className="text-sm text-[#1f2329]">
                                                {item.unitPrice ? formatMoney(item.unitPrice) : "—"}
                                              </span>
                                            </td>
                                            <td className="px-4 py-2">
                                              <span className="text-sm font-medium text-[#1f2329]">
                                                {formatDelta(getDiffDelta(item))}
                                              </span>
                                            </td>
                                          </tr>
                                          {showTrace && (
                                            <tr className="bg-[white]">
                                              <td colSpan={6} className="px-4 pb-4">
                                                <div className="rounded-lg border border-[#e8eaed] bg-[#f8f9fb]">
                                                  <div className="flex items-center justify-between px-3 py-2 text-xs text-[#8f959e]">
                                                    <span>关联BOM</span>
                                                    <div className="flex items-center gap-2">
                                                      <span>共 {traceItems.length} 条</span>
                                                      <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="sm"
                                                        className="h-7"
                                                        onClick={() => item.itemId && loadDiffTraceBoms(item.id, item.itemId)}
                                                        disabled={!item.itemId || traceLoading}
                                                      >
                                                        {hasTraceKey ? "刷新" : "获取"}
                                                      </Button>
                                                      <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-7"
                                                        onClick={() =>
                                                          setDiffTraceFolded((prev) => ({ ...prev, [item.id]: !prev[item.id] }))
                                                        }
                                                        disabled={!hasTraceKey}
                                                      >
                                                        {traceFolded ? (
                                                          <>
                                                            <ChevronRight className="h-3.5 w-3.5" />
                                                            展开
                                                          </>
                                                        ) : (
                                                          <>
                                                            <ChevronDown className="h-3.5 w-3.5" />
                                                            折叠
                                                          </>
                                                        )}
                                                      </Button>
                                                    </div>
                                                  </div>
                                                  {traceLoading ? (
                                                    <div className="px-3 py-3 text-xs text-[#8f959e]">正在加载...</div>
                                                  ) : traceError ? (
                                                    <div className="px-3 py-3 text-xs text-red-500">{traceError}</div>
                                                  ) : traceItems.length > 0 ? (
                                                    !traceFolded && (
                                                      <div className="overflow-x-auto border-t border-[#e8eaed]">
                                                        <table className="w-full text-xs">
                                                          <thead className="bg-[white] text-[#8f959e]">
                                                            <tr>
                                                              <th className="px-3 py-2 text-left font-medium">BOM编号</th>
                                                              <th className="px-3 py-2 text-left font-medium">BOM代码</th>
                                                              <th className="px-3 py-2 text-left font-medium">BOM名称</th>
                                                              <th className="px-3 py-2 text-right font-medium">用量</th>
                                                              <th className="px-3 py-2 text-left font-medium">审核日期</th>
                                                              <th className="px-3 py-2 text-right font-medium">操作</th>
                                                            </tr>
                                                          </thead>
                                                          <tbody className="divide-y divide-[#e8eaed]">
                                                            {traceItems.map((trace, index) => (
                                                              <tr key={`${trace.bomNumber || trace.bomCode}-${index}`}>
                                                                <td className="px-3 py-2">
                                                                  <span className="text-[#1f2329] font-mono">
                                                                    {trace.bomNumber || "—"}
                                                                  </span>
                                                                </td>
                                                                <td className="px-3 py-2">
                                                                  <span className="text-[#1f2329]">
                                                                    {trace.bomCode || "—"}
                                                                  </span>
                                                                </td>
                                                                <td className="px-3 py-2">
                                                                  <span className="text-[#1f2329]">
                                                                    {trace.bomName || "—"}
                                                                  </span>
                                                                </td>
                                                                <td className="px-3 py-2 text-right">
                                                                  <span className="text-[#1f2329]">
                                                                    {formatQtyValue(trace.auxQty || 0)}
                                                                  </span>
                                                                </td>
                                                                <td className="px-3 py-2">
                                                                  <span className="text-[#1f2329]">
                                                                    {formatDateValue(trace.audDate)}
                                                                  </span>
                                                                </td>
                                                                <td className="px-3 py-2 text-right">
                                                                  <Button
                                                                    type="button"
                                                                    variant="ghost"
                                                                    size="sm"
                                                                    className="h-7 text-slate-400 hover:text-red-500"
                                                                    onClick={() => removeDiffTraceItem(item.id, index)}
                                                                    disabled={!canCreate}
                                                                  >
                                                                    删除
                                                                  </Button>
                                                                </td>
                                                              </tr>
                                                            ))}
                                                          </tbody>
                                                        </table>
                                                      </div>
                                                    )
                                                  ) : (
                                                    <div className="px-3 py-3 text-xs text-[#8f959e]">未找到关联BOM</div>
                                                  )}
                                                </div>
                                              </td>
                                            </tr>
                                          )}
                                        </Fragment>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            ) : (
                              <div className="px-3 py-4 text-center text-xs text-[#8f959e]">暂无明细</div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="rounded-xl border border-[#e8eaed] overflow-hidden">
                      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-[#e8eaed] bg-[#f8f9fb]">
                        <div className="text-sm font-medium text-[#1f2329]">原材料替换</div>
                        <Button type="button" variant="outline" size="sm" className="h-8" onClick={addAdjustmentItem} disabled={!canCreate}>
                          新增行
                        </Button>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-[#f8f9fb] text-xs text-[#8f959e]">
                            <tr>
                              <th className="px-4 py-2 text-left font-medium">替换自编码</th>
                              <th className="px-4 py-2 text-left font-medium">替换自名称</th>
                              <th className="px-4 py-2 text-left font-medium">替换为编码</th>
                              <th className="px-4 py-2 text-left font-medium">替换为名称</th>
                              <th className="px-4 py-2 text-right font-medium">操作</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#e8eaed]">
                            {formData.bomMaterialAdjustments && formData.bomMaterialAdjustments.length > 0 ? (
                              formData.bomMaterialAdjustments.map((item) => {
                                const traceItems = rawReplaceBomMap[item.id] || [];
                                const traceLoading = rawReplaceBomLoading[item.id];
                                const traceError = rawReplaceBomError[item.id];
                                const traceFolded = rawReplaceBomFolded[item.id];
                                const traceEntryId = rawReplaceItemIdMap[item.id];
                                const hasTraceKey = Object.prototype.hasOwnProperty.call(
                                  rawReplaceBomMap,
                                  item.id
                                );
                                const showTrace = traceLoading || Boolean(traceError) || hasTraceKey;
                                return (
                                  <Fragment key={item.id}>
                                    <tr className="bg-[white]">
                                      <td className="px-4 py-2">
                                        <div className="flex items-center gap-2">
                                          <Input
                                            value={item.replaceFromCode}
                                            onChange={(event) => updateAdjustmentItem(item.id, "replaceFromCode", event.target.value)}
                                            className="h-9"
                                            placeholder="如：MAT-001"
                                            disabled={!canCreate}
                                          />
                                          <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="h-8"
                                            onClick={() => openMaterialModal(item.id, "from")}
                                            disabled={!canCreate}
                                          >
                                            选择
                                          </Button>
                                        </div>
                                      </td>
                                      <td className="px-4 py-2">
                                        <Input
                                          value={item.replaceFromName}
                                          onChange={(event) => updateAdjustmentItem(item.id, "replaceFromName", event.target.value)}
                                          className="h-9"
                                          placeholder="物料名称"
                                          disabled={!canCreate}
                                        />
                                      </td>
                                      <td className="px-4 py-2">
                                        <div className="flex items-center gap-2">
                                          <Input
                                            value={item.replaceToCode}
                                            onChange={(event) => updateAdjustmentItem(item.id, "replaceToCode", event.target.value)}
                                            className="h-9"
                                            placeholder="如：MAT-002"
                                            disabled={!canCreate}
                                          />
                                          <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="h-8"
                                            onClick={() => openMaterialModal(item.id, "to")}
                                            disabled={!canCreate}
                                          >
                                            选择
                                          </Button>
                                        </div>
                                      </td>
                                      <td className="px-4 py-2">
                                        <Input
                                          value={item.replaceToName}
                                          onChange={(event) => updateAdjustmentItem(item.id, "replaceToName", event.target.value)}
                                          className="h-9"
                                          placeholder="物料名称"
                                          disabled={!canCreate}
                                        />
                                      </td>
                                      <td className="px-4 py-2 text-right">
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="sm"
                                          className="text-slate-400 hover:text-red-500"
                                          onClick={() => removeAdjustmentItem(item.id)}
                                          disabled={!canCreate}
                                        >
                                          删除
                                        </Button>
                                      </td>
                                    </tr>
                                    {showTrace && (
                                      <tr className="bg-[white]">
                                        <td colSpan={5} className="px-4 pb-4">
                                          <div className="rounded-lg border border-[#e8eaed] bg-[#f8f9fb]">
                                            <div className="flex items-center justify-between px-3 py-2 text-xs text-[#8f959e]">
                                              <span>关联BOM</span>
                                            <div className="flex items-center gap-2">
                                              <span>共 {traceItems.length} 条</span>
                                              <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                className="h-7"
                                                onClick={() => traceEntryId && loadRawReplaceBoms(item.id, traceEntryId)}
                                                disabled={!traceEntryId || traceLoading}
                                              >
                                                刷新
                                              </Button>
                                              <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                className="h-7"
                                                  onClick={() => toggleRawReplaceFold(item.id)}
                                                >
                                                  {traceFolded ? (
                                                    <>
                                                      <ChevronRight className="h-3.5 w-3.5" />
                                                      展开
                                                    </>
                                                  ) : (
                                                    <>
                                                      <ChevronDown className="h-3.5 w-3.5" />
                                                      折叠
                                                    </>
                                                  )}
                                                </Button>
                                              </div>
                                            </div>
                                            {traceLoading ? (
                                              <div className="px-3 py-3 text-xs text-[#8f959e]">正在加载...</div>
                                            ) : traceError ? (
                                              <div className="px-3 py-3 text-xs text-rose-500">{traceError}</div>
                                            ) : traceFolded ? (
                                              <div className="px-3 py-3 text-xs text-[#8f959e]">已折叠</div>
                                            ) : traceItems.length > 0 ? (
                                              <div className="overflow-x-auto">
                                                <table className="w-full text-xs">
                                                  <thead className="bg-[white] text-[#8f959e]">
                                                    <tr>
                                                      <th className="px-3 py-2 text-left font-medium">BOM编号</th>
                                                      <th className="px-3 py-2 text-left font-medium">BOM代码</th>
                                                      <th className="px-3 py-2 text-left font-medium">BOM名称</th>
                                                      <th className="px-3 py-2 text-right font-medium">用量</th>
                                                      <th className="px-3 py-2 text-left font-medium">审核日期</th>
                                                      <th className="px-3 py-2 text-right font-medium">操作</th>
                                                    </tr>
                                                  </thead>
                                                  <tbody className="divide-y divide-[#e8eaed]">
                                                    {traceItems.map((trace, index) => (
                                                      <tr key={`${trace.bomNumber || trace.bomCode}-${index}`}>
                                                        <td className="px-3 py-2">
                                                          <span className="text-[#1f2329] font-mono">
                                                            {trace.bomNumber || "—"}
                                                          </span>
                                                        </td>
                                                        <td className="px-3 py-2">
                                                          <span className="text-[#1f2329] font-mono">
                                                            {trace.bomCode || "—"}
                                                          </span>
                                                        </td>
                                                        <td className="px-3 py-2">
                                                          <span className="text-[#1f2329]">
                                                            {trace.bomName || "—"}
                                                          </span>
                                                        </td>
                                                        <td className="px-3 py-2 text-right">
                                                          <span className="text-[#1f2329]">
                                                            {formatQtyValue(trace.auxQty || 0)}
                                                          </span>
                                                        </td>
                                                        <td className="px-3 py-2">
                                                          <span className="text-[#1f2329]">
                                                            {formatDateValue(trace.audDate)}
                                                          </span>
                                                        </td>
                                                        <td className="px-3 py-2 text-right">
                                                          <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="sm"
                                                            className="h-7 text-slate-400 hover:text-red-500"
                                                            onClick={() => removeRawReplaceBom(item.id, index)}
                                                            disabled={!canCreate}
                                                          >
                                                            删除
                                                          </Button>
                                                        </td>
                                                      </tr>
                                                    ))}
                                                  </tbody>
                                                </table>
                                              </div>
                                            ) : (
                                              <div className="px-3 py-3 text-xs text-[#8f959e]">未找到关联BOM</div>
                                            )}
                                          </div>
                                        </td>
                                      </tr>
                                    )}
                                  </Fragment>
                                );
                              })
                            ) : (
                              <tr>
                                <td colSpan={5} className="px-4 py-6 text-center text-[#8f959e]">
                                  暂无变更项
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                      </>
                    )}

                    {formData.bomChangeType === "materialAdjust" && (
                      <>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      <div className="rounded-2xl border border-[#e8eaed] bg-[#f8f9fb] p-4 space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-1">
                            <div className="text-sm font-medium text-[#1f2329]">基础 BOM</div>
                            <div className="text-xs text-[#8f959e]">作为基准物料清单</div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              type="button"
                              variant={formData.formTemplateId ? "outline" : "default"}
                              className={formData.formTemplateId ? "" : "bg-emerald-600 hover:bg-emerald-700 text-white"}
                              onClick={() => {
                                if (!canEditBom) return;
                                setBomSelectMode("base");
                                setIsModalOpen(true);
                              }}
                              disabled={!canEditBom}
                            >
                              {formData.formTemplateId ? "更换 BOM" : "选择 BOM"}
                            </Button>
                            {formData.formTemplateId && (
                              <Button
                                type="button"
                                variant="ghost"
                                className="text-slate-400 hover:text-red-500"
                                onClick={handleClearSelection}
                                disabled={!canEditBom}
                              >
                                清空
                              </Button>
                            )}
                          </div>
                        </div>
                        {formData.formTemplateId ? (
                          <div className="space-y-2">
                            <div className="text-sm font-semibold text-[#1f2329] truncate">
                              {selectedTemplate?.name || "已选择 BOM"}
                            </div>
                            <div className="flex flex-wrap items-center gap-2 text-xs text-[#8f959e]">
                              <span className="font-mono bg-white/70 px-2 py-0.5 rounded">
                                BOM编码 {selectedTemplate?.bomNumber || formData.bomCode || selectedTemplate?.code || "—"}
                              </span>
                              <span className="rounded-full border border-[#e8eaed] bg-[white] px-2 py-0.5">
                                编码 {selectedTemplate?.code || "—"}
                              </span>
                              <span className="rounded-full border border-[#e8eaed] bg-[white] px-2 py-0.5">
                                日期 {selectedTemplate?.createdAt || "—"}
                              </span>
                            </div>
                            <div className="rounded-lg border border-[#e8eaed] bg-[white]">
                              <div className="flex items-center justify-between px-3 py-2 text-xs text-[#1f2329]">
                                <span>基础BOM明细（{sortedBaseMaterials.length}）</span>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2"
                                  onClick={() => setIsBaseBomDetailOpen((prev) => !prev)}
                                >
                                  {isBaseBomDetailOpen ? (
                                    <>
                                      <ChevronDown className="h-3.5 w-3.5" />
                                      收起
                                    </>
                                  ) : (
                                    <>
                                      <ChevronRight className="h-3.5 w-3.5" />
                                      展开
                                    </>
                                  )}
                                </Button>
                              </div>
                              {isBaseBomDetailOpen && (
                                <div className="overflow-x-auto border-t border-[#e8eaed]">
                                  <table className="w-full text-xs">
                                    <thead className="bg-[#f8f9fb] text-[#8f959e]">
                                      <tr>
                                        <th className="px-3 py-2 text-left font-medium">序号</th>
                                        <th className="px-3 py-2 text-left font-medium">物料编码</th>
                                        <th className="px-3 py-2 text-left font-medium">物料名称</th>
                                        <th className="px-3 py-2 text-right font-medium">用量</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[#e8eaed]">
                                      {sortedBaseMaterials.length > 0 ? (
                                        sortedBaseMaterials.map((item, index) => (
                                          <tr key={`base-${item.entryId}-${item.materialCode}`}>
                                            <td className="px-3 py-2 text-[#8f959e]">{index + 1}</td>
                                            <td className="px-3 py-2 font-mono">{item.materialCode || "—"}</td>
                                            <td className="px-3 py-2">{item.materialName || "—"}</td>
                                            <td className="px-3 py-2 text-right">{formatQtyValue(item.quantity)}</td>
                                          </tr>
                                        ))
                                      ) : (
                                        <tr>
                                          <td colSpan={4} className="px-3 py-4 text-center text-[#8f959e]">
                                            暂无明细
                                          </td>
                                        </tr>
                                      )}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="text-xs text-[#8f959e]">未关联 BOM</div>
                        )}
                      </div>
                      <div className="rounded-2xl border border-[#e8eaed] bg-[#f8f9fb] p-4 space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-1">
                            <div className="text-sm font-medium text-[#1f2329]">目标 BOM</div>
                            <div className="text-xs text-[#8f959e]">对比目标与影响范围</div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              type="button"
                              variant={formData.bomTargetId ? "outline" : "default"}
                              className={formData.bomTargetId ? "" : "bg-emerald-600 hover:bg-emerald-700 text-white"}
                              onClick={() => {
                                if (!canEditBom) return;
                                setBomSelectMode("target");
                                setIsModalOpen(true);
                              }}
                              disabled={!canEditBom}
                            >
                              {formData.bomTargetId ? "更换 BOM" : "选择 BOM"}
                            </Button>
                            {formData.bomTargetId && (
                              <Button
                                type="button"
                                variant="ghost"
                                className="text-slate-400 hover:text-red-500"
                                onClick={handleClearTargetSelection}
                                disabled={!canEditBom}
                              >
                                清空
                              </Button>
                            )}
                          </div>
                        </div>
                        {formData.bomTargetId ? (
                          <div className="space-y-2">
                            <div className="text-sm font-semibold text-[#1f2329] truncate">
                              {selectedTargetTemplate?.name || "已选择 BOM"}
                            </div>
                            <div className="flex flex-wrap items-center gap-2 text-xs text-[#8f959e]">
                              <span className="font-mono bg-white/70 px-2 py-0.5 rounded">
                                BOM编码 {selectedTargetTemplate?.bomNumber || formData.bomTargetCode || selectedTargetTemplate?.code || "—"}
                              </span>
                              <span className="rounded-full border border-[#e8eaed] bg-[white] px-2 py-0.5">
                                编码 {selectedTargetTemplate?.code || "—"}
                              </span>
                              <span className="rounded-full border border-[#e8eaed] bg-[white] px-2 py-0.5">
                                日期 {selectedTargetTemplate?.createdAt || "—"}
                              </span>
                            </div>
                            <div className="rounded-lg border border-[#e8eaed] bg-[white]">
                              <div className="flex items-center justify-between px-3 py-2 text-xs text-[#1f2329]">
                                <span>目标BOM明细（{sortedTargetMaterials.length}）</span>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2"
                                  onClick={() => setIsTargetBomDetailOpen((prev) => !prev)}
                                >
                                  {isTargetBomDetailOpen ? (
                                    <>
                                      <ChevronDown className="h-3.5 w-3.5" />
                                      收起
                                    </>
                                  ) : (
                                    <>
                                      <ChevronRight className="h-3.5 w-3.5" />
                                      展开
                                    </>
                                  )}
                                </Button>
                              </div>
                              {isTargetBomDetailOpen && (
                                <div className="overflow-x-auto border-t border-[#e8eaed]">
                                  <table className="w-full text-xs">
                                    <thead className="bg-[#f8f9fb] text-[#8f959e]">
                                      <tr>
                                        <th className="px-3 py-2 text-left font-medium">序号</th>
                                        <th className="px-3 py-2 text-left font-medium">物料编码</th>
                                        <th className="px-3 py-2 text-left font-medium">物料名称</th>
                                        <th className="px-3 py-2 text-right font-medium">用量</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[#e8eaed]">
                                      {sortedTargetMaterials.length > 0 ? (
                                        sortedTargetMaterials.map((item, index) => (
                                          <tr key={`target-${item.entryId}-${item.materialCode}`}>
                                            <td className="px-3 py-2 text-[#8f959e]">{index + 1}</td>
                                            <td className="px-3 py-2 font-mono">{item.materialCode || "—"}</td>
                                            <td className="px-3 py-2">{item.materialName || "—"}</td>
                                            <td className="px-3 py-2 text-right">{formatQtyValue(item.quantity)}</td>
                                          </tr>
                                        ))
                                      ) : (
                                        <tr>
                                          <td colSpan={4} className="px-3 py-4 text-center text-[#8f959e]">
                                            暂无明细
                                          </td>
                                        </tr>
                                      )}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="text-xs text-[#8f959e]">未选择目标 BOM</div>
                        )}
                      </div>
                    </div>

                    <div className="rounded-xl border border-[#e8eaed] overflow-hidden bg-[white]">
                      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-[#e8eaed] bg-[#f8f9fb]">
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 text-[#1f2329]"
                            onClick={() => setIsDiffOpen((prev) => !prev)}
                          >
                            {isDiffOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            {isDiffOpen ? "收起" : "展开"}
                          </Button>
                          <div className="text-sm font-medium text-[#1f2329]">差异清单</div>
                        </div>
                        {canUseCustDiffSelection && (
                          <div className="flex items-center gap-2 text-xs text-[#8f959e]">
                            <span>
                              基础 {selectedBaseCustDiffCount} · 目标 {selectedTargetCustDiffCount}
                            </span>
                            <Button
                              type="button"
                              size="sm"
                              className="h-7"
                              onClick={() => setIsCustDiffPickerOpen(true)}
                            >
                              选择差异
                            </Button>
                          </div>
                        )}
                      </div>
                      {isDiffOpen && (
                        <div className="p-4 space-y-4">
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                            <div className="rounded-xl border border-[#e8eaed] overflow-hidden bg-[white]">
                              <div className="px-4 py-3 border-b border-[#e8eaed] bg-[#f8f9fb]">
                                <div className="text-xs uppercase tracking-wide text-[#8f959e]">
                                  旧BOM有 / 新BOM无
                                </div>
                                <div className="text-base font-semibold text-[#1f2329]">
                                  {diffGroups.baseOnly.length} 项
                                </div>
                              </div>
                              {orderedBaseOnly.length > 0 ? (
                                <div className="overflow-x-auto">
                                  <table className="w-full text-sm">
                                    <thead className="bg-[#f8f9fb] text-xs text-[#8f959e]">
                                      <tr>
                                        <th className="px-4 py-2 text-left font-medium">物料编码</th>
                                        <th className="px-4 py-2 text-left font-medium">物料名称</th>
                                        <th className="px-4 py-2 text-left font-medium">用量</th>
                                        <th className="px-4 py-2 text-right font-medium">最新采购单价</th>
                                        <th className="px-4 py-2 text-center font-medium"></th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[#e8eaed]">
                                      {orderedBaseOnly.map((item) => {
                                        const traceItems = diffTraceMap[item.id] || [];
                                        const traceLoading = diffTraceLoading[item.id];
                                        const traceError = diffTraceError[item.id];
                                        const traceFolded = diffTraceFolded[item.id];
                                        const hasTraceKey = Object.prototype.hasOwnProperty.call(diffTraceMap, item.id);
                                        const hasItemId = Boolean(item.itemId?.trim());
                                        const showTrace = hasItemId || traceLoading || Boolean(traceError) || hasTraceKey;
                                        const diffKey = getDiffOrderKey(item);
                                        return (
                                          <Fragment key={item.id}>
                                            <tr
                                              className="bg-[white]"
                                              draggable={canEditBom}
                                              onDragStart={() => canEditBom && onDragStart("base", diffKey)}
                                              onDragOver={onDragOver}
                                              onDrop={() => canEditBom && onDrop("base", diffKey)}
                                              onDragEnd={onDragEnd}
                                            >
                                              <td className="px-4 py-2">
                                                <span className="text-sm text-[#1f2329] font-mono">
                                                  {item.materialCode || "—"}
                                                </span>
                                              </td>
                                              <td className="px-4 py-2">
                                                <span className="text-sm text-[#1f2329]">
                                                  {item.materialName || "—"}
                                                </span>
                                              </td>
                                              <td className="px-4 py-2">
                                                <span className="text-sm text-[#1f2329]">
                                                  {item.baseQty || "0"}
                                                </span>
                                              </td>
                                              <td className="px-4 py-2 text-right">
                                                <span className="text-sm text-[#1f2329]">
                                                  {item.unitPrice ? formatMoney(item.unitPrice) : "—"}
                                                </span>
                                              </td>
                                              <td className="px-4 py-2">
                                                <span className="inline-flex items-center justify-center w-8 h-8 rounded-full border border-[#e8eaed] bg-gradient-to-br from-[white] to-[#f8f9fb] text-[#8f959e] shadow-sm">
                                                  <GripVertical className="h-4 w-4" />
                                                </span>
                                              </td>
                                            </tr>
                                            {showTrace && (
                                              <tr className="bg-[white]">
                                                <td colSpan={5} className="px-4 pb-4">
                                                  <div className="rounded-lg border border-[#e8eaed] bg-[#f8f9fb]">
                                                    <div className="flex items-center justify-between px-3 py-2 text-xs text-[#8f959e]">
                                                      <span>关联BOM</span>
                                                      <div className="flex items-center gap-2">
                                                        <span>共 {traceItems.length} 条</span>
                                                        <Button
                                                          type="button"
                                                          variant="outline"
                                                          size="sm"
                                                          className="h-7"
                                                          onClick={() => item.itemId && loadDiffTraceBoms(item.id, item.itemId)}
                                                          disabled={!item.itemId || traceLoading}
                                                        >
                                                          {hasTraceKey ? "刷新" : "获取"}
                                                        </Button>
                                                        <Button
                                                          type="button"
                                                          variant="ghost"
                                                          size="sm"
                                                          className="h-7"
                                                          onClick={() =>
                                                            setDiffTraceFolded((prev) => ({ ...prev, [item.id]: !prev[item.id] }))
                                                          }
                                                          disabled={!hasTraceKey}
                                                        >
                                                          {traceFolded ? (
                                                            <>
                                                              <ChevronRight className="h-3.5 w-3.5" />
                                                              展开
                                                            </>
                                                          ) : (
                                                            <>
                                                              <ChevronDown className="h-3.5 w-3.5" />
                                                              折叠
                                                            </>
                                                          )}
                                                        </Button>
                                                      </div>
                                                    </div>
                                                    {traceLoading ? (
                                                      <div className="px-3 py-3 text-xs text-[#8f959e]">正在加载...</div>
                                                    ) : traceError ? (
                                                      <div className="px-3 py-3 text-xs text-red-500">{traceError}</div>
                                                    ) : traceItems.length > 0 ? (
                                                      !traceFolded && (
                                                        <div className="overflow-x-auto border-t border-[#e8eaed]">
                                                          <table className="w-full text-xs">
                                                            <thead className="bg-[white] text-[#8f959e]">
                                                              <tr>
                                                                <th className="px-3 py-2 text-left font-medium">BOM编号</th>
                                                                <th className="px-3 py-2 text-left font-medium">BOM代码</th>
                                                                <th className="px-3 py-2 text-left font-medium">BOM名称</th>
                                                                <th className="px-3 py-2 text-right font-medium">用量</th>
                                                                <th className="px-3 py-2 text-left font-medium">审核日期</th>
                                                              </tr>
                                                            </thead>
                                                            <tbody className="divide-y divide-[#e8eaed]">
                                                              {traceItems.map((trace, traceIndex) => (
                                                                <tr key={`${trace.bomNumber || trace.bomCode}-${traceIndex}`}>
                                                                  <td className="px-3 py-2">
                                                                    <span className="text-[#1f2329] font-mono">
                                                                      {trace.bomNumber || "—"}
                                                                    </span>
                                                                  </td>
                                                                  <td className="px-3 py-2">
                                                                    <span className="text-[#1f2329]">
                                                                      {trace.bomCode || "—"}
                                                                    </span>
                                                                  </td>
                                                                  <td className="px-3 py-2">
                                                                    <span className="text-[#1f2329]">
                                                                      {trace.bomName || "—"}
                                                                    </span>
                                                                  </td>
                                                                  <td className="px-3 py-2 text-right">
                                                                    <span className="text-[#1f2329]">
                                                                      {formatQtyValue(trace.auxQty || 0)}
                                                                    </span>
                                                                  </td>
                                                                  <td className="px-3 py-2">
                                                                    <span className="text-[#1f2329]">
                                                                      {formatDateValue(trace.audDate)}
                                                                    </span>
                                                                  </td>
                                                                </tr>
                                                              ))}
                                                            </tbody>
                                                          </table>
                                                        </div>
                                                      )
                                                    ) : (
                                                      <div className="px-3 py-3 text-xs text-[#8f959e]">未找到关联BOM</div>
                                                    )}
                                                  </div>
                                                </td>
                                              </tr>
                                            )}
                                          </Fragment>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              ) : (
                                <div className="px-3 py-4 text-center text-xs text-[#8f959e]">暂无明细</div>
                              )}
                            </div>
                            <div className="rounded-xl border border-[#e8eaed] overflow-hidden bg-[white]">
                              <div className="px-4 py-3 border-b border-[#e8eaed] bg-[#f8f9fb]">
                                <div className="text-xs uppercase tracking-wide text-[#8f959e]">
                                  新BOM有 / 旧BOM无
                                </div>
                                <div className="text-base font-semibold text-[#1f2329]">
                                  {diffGroups.targetOnly.length} 项
                                </div>
                              </div>
                              {orderedTargetOnly.length > 0 ? (
                                <div className="overflow-x-auto">
                                  <table className="w-full text-sm">
                                    <thead className="bg-[#f8f9fb] text-xs text-[#8f959e]">
                                      <tr>
                                        <th className="px-4 py-2 text-left font-medium">物料编码</th>
                                        <th className="px-4 py-2 text-left font-medium">物料名称</th>
                                        <th className="px-4 py-2 text-left font-medium">用量</th>
                                        <th className="px-4 py-2 text-right font-medium">最新采购单价</th>
                                        <th className="px-4 py-2 text-center font-medium"></th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[#e8eaed]">
                                      {orderedTargetOnly.map((item) => {
                                        const traceItems = diffTraceMap[item.id] || [];
                                        const traceLoading = diffTraceLoading[item.id];
                                        const traceError = diffTraceError[item.id];
                                        const traceFolded = diffTraceFolded[item.id];
                                        const hasTraceKey = Object.prototype.hasOwnProperty.call(diffTraceMap, item.id);
                                        const hasItemId = Boolean(item.itemId?.trim());
                                        const showTrace = hasItemId || traceLoading || Boolean(traceError) || hasTraceKey;
                                        const diffKey = getDiffOrderKey(item);
                                        return (
                                          <Fragment key={item.id}>
                                            <tr
                                              className="bg-[white]"
                                              draggable={canEditBom}
                                              onDragStart={() => canEditBom && onDragStart("target", diffKey)}
                                              onDragOver={onDragOver}
                                              onDrop={() => canEditBom && onDrop("target", diffKey)}
                                              onDragEnd={onDragEnd}
                                            >
                                              <td className="px-4 py-2">
                                                <span className="text-sm text-[#1f2329] font-mono">
                                                  {item.materialCode || "—"}
                                                </span>
                                              </td>
                                              <td className="px-4 py-2">
                                                <span className="text-sm text-[#1f2329]">
                                                  {item.materialName || "—"}
                                                </span>
                                              </td>
                                              <td className="px-4 py-2">
                                                <span className="text-sm text-[#1f2329]">
                                                  {item.targetQty || "0"}
                                                </span>
                                              </td>
                                              <td className="px-4 py-2">
                                                <span className="inline-flex items-center justify-center w-8 h-8 rounded-full border border-[#e8eaed] bg-gradient-to-br from-[white] to-[#f8f9fb] text-[#8f959e] shadow-sm">
                                                  <GripVertical className="h-4 w-4" />
                                                </span>
                                              </td>
                                            </tr>
                                            {showTrace && (
                                              <tr className="bg-[white]">
                                                <td colSpan={4} className="px-4 pb-4">
                                                  <div className="rounded-lg border border-[#e8eaed] bg-[#f8f9fb]">
                                                    <div className="flex items-center justify-between px-3 py-2 text-xs text-[#8f959e]">
                                                      <span>关联BOM</span>
                                                      <div className="flex items-center gap-2">
                                                        <span>共 {traceItems.length} 条</span>
                                                        <Button
                                                          type="button"
                                                          variant="outline"
                                                          size="sm"
                                                          className="h-7"
                                                          onClick={() => item.itemId && loadDiffTraceBoms(item.id, item.itemId)}
                                                          disabled={!item.itemId || traceLoading}
                                                        >
                                                          {hasTraceKey ? "刷新" : "获取"}
                                                        </Button>
                                                        <Button
                                                          type="button"
                                                          variant="ghost"
                                                          size="sm"
                                                          className="h-7"
                                                          onClick={() =>
                                                            setDiffTraceFolded((prev) => ({ ...prev, [item.id]: !prev[item.id] }))
                                                          }
                                                          disabled={!hasTraceKey}
                                                        >
                                                          {traceFolded ? (
                                                            <>
                                                              <ChevronRight className="h-3.5 w-3.5" />
                                                              展开
                                                            </>
                                                          ) : (
                                                            <>
                                                              <ChevronDown className="h-3.5 w-3.5" />
                                                              折叠
                                                            </>
                                                          )}
                                                        </Button>
                                                      </div>
                                                    </div>
                                                    {traceLoading ? (
                                                      <div className="px-3 py-3 text-xs text-[#8f959e]">正在加载...</div>
                                                    ) : traceError ? (
                                                      <div className="px-3 py-3 text-xs text-red-500">{traceError}</div>
                                                    ) : traceItems.length > 0 ? (
                                                      !traceFolded && (
                                                        <div className="overflow-x-auto border-t border-[#e8eaed]">
                                                          <table className="w-full text-xs">
                                                            <thead className="bg-[white] text-[#8f959e]">
                                                              <tr>
                                                                <th className="px-3 py-2 text-left font-medium">BOM编号</th>
                                                                <th className="px-3 py-2 text-left font-medium">BOM代码</th>
                                                                <th className="px-3 py-2 text-left font-medium">BOM名称</th>
                                                                <th className="px-3 py-2 text-right font-medium">用量</th>
                                                                <th className="px-3 py-2 text-left font-medium">审核日期</th>
                                                              </tr>
                                                            </thead>
                                                            <tbody className="divide-y divide-[#e8eaed]">
                                                              {traceItems.map((trace, traceIndex) => (
                                                                <tr key={`${trace.bomNumber || trace.bomCode}-${traceIndex}`}>
                                                                  <td className="px-3 py-2">
                                                                    <span className="text-[#1f2329] font-mono">
                                                                      {trace.bomNumber || "—"}
                                                                    </span>
                                                                  </td>
                                                                  <td className="px-3 py-2">
                                                                    <span className="text-[#1f2329]">
                                                                      {trace.bomCode || "—"}
                                                                    </span>
                                                                  </td>
                                                                  <td className="px-3 py-2">
                                                                    <span className="text-[#1f2329]">
                                                                      {trace.bomName || "—"}
                                                                    </span>
                                                                  </td>
                                                                  <td className="px-3 py-2 text-right">
                                                                    <span className="text-[#1f2329]">
                                                                      {formatQtyValue(trace.auxQty || 0)}
                                                                    </span>
                                                                  </td>
                                                                  <td className="px-3 py-2">
                                                                    <span className="text-[#1f2329]">
                                                                      {formatDateValue(trace.audDate)}
                                                                    </span>
                                                                  </td>
                                                                </tr>
                                                              ))}
                                                            </tbody>
                                                          </table>
                                                        </div>
                                                      )
                                                    ) : (
                                                      <div className="px-3 py-3 text-xs text-[#8f959e]">未找到关联BOM</div>
                                                    )}
                                                  </div>
                                                </td>
                                              </tr>
                                            )}
                                          </Fragment>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              ) : (
                                <div className="px-3 py-4 text-center text-xs text-[#8f959e]">暂无明细</div>
                              )}
                            </div>
                          </div>
                          <div className="rounded-xl border border-[#e8eaed] overflow-hidden bg-[white]">
                            <div className="px-4 py-3 border-b border-[#e8eaed] bg-[#f8f9fb]">
                              <div className="text-xs uppercase tracking-wide text-[#8f959e]">用量变化</div>
                              <div className="text-base font-semibold text-[#1f2329]">
                                {diffGroups.changed.length} 项
                              </div>
                            </div>
                            {diffGroups.changed.length > 0 ? (
                              <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                  <thead className="bg-[#f8f9fb] text-xs text-[#8f959e]">
                                    <tr>
                                      <th className="px-4 py-2 text-left font-medium">物料编码</th>
                                      <th className="px-4 py-2 text-left font-medium">物料名称</th>
                                      <th className="px-4 py-2 text-left font-medium">旧BOM用量</th>
                                      <th className="px-4 py-2 text-left font-medium">新BOM用量</th>
                                      <th className="px-4 py-2 text-right font-medium">最新采购单价</th>
                                      <th className="px-4 py-2 text-left font-medium">差异</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-[#e8eaed]">
                                    {diffGroups.changed.map((item) => {
                                      const traceItems = diffTraceMap[item.id] || [];
                                      const traceLoading = diffTraceLoading[item.id];
                                      const traceError = diffTraceError[item.id];
                                      const traceFolded = diffTraceFolded[item.id];
                                      const hasTraceKey = Object.prototype.hasOwnProperty.call(diffTraceMap, item.id);
                                      const hasItemId = Boolean(item.itemId?.trim());
                                      const showTrace = hasItemId || traceLoading || Boolean(traceError) || hasTraceKey;
                                      return (
                                        <Fragment key={item.id}>
                                          <tr className="bg-[white]">
                                            <td className="px-4 py-2">
                                              <span className="text-sm text-[#1f2329]">
                                                {item.materialCode || "—"}
                                              </span>
                                            </td>
                                            <td className="px-4 py-2">
                                              <span className="text-sm text-[#1f2329]">
                                                {item.materialName || "—"}
                                              </span>
                                            </td>
                                            <td className="px-4 py-2">
                                              <span className="text-sm text-[#1f2329]">
                                                {item.baseQty || "0"}
                                              </span>
                                            </td>
                                            <td className="px-4 py-2">
                                              <span className="text-sm text-[#1f2329]">
                                                {item.targetQty || "0"}
                                              </span>
                                            </td>
                                            <td className="px-4 py-2 text-right">
                                              <span className="text-sm text-[#1f2329]">
                                                {item.unitPrice ? formatMoney(item.unitPrice) : "—"}
                                              </span>
                                            </td>
                                            <td className="px-4 py-2">
                                              <span className="text-sm font-medium text-[#1f2329]">
                                                {formatDelta(getDiffDelta(item))}
                                              </span>
                                            </td>
                                          </tr>
                                          {showTrace && (
                                            <tr className="bg-[white]">
                                              <td colSpan={5} className="px-4 pb-4">
                                                <div className="rounded-lg border border-[#e8eaed] bg-[#f8f9fb]">
                                                  <div className="flex items-center justify-between px-3 py-2 text-xs text-[#8f959e]">
                                                    <span>关联BOM</span>
                                                    <div className="flex items-center gap-2">
                                                      <span>共 {traceItems.length} 条</span>
                                                      <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="sm"
                                                        className="h-7"
                                                        onClick={() => item.itemId && loadDiffTraceBoms(item.id, item.itemId)}
                                                        disabled={!item.itemId || traceLoading}
                                                      >
                                                        {hasTraceKey ? "刷新" : "获取"}
                                                      </Button>
                                                      <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-7"
                                                        onClick={() =>
                                                          setDiffTraceFolded((prev) => ({ ...prev, [item.id]: !prev[item.id] }))
                                                        }
                                                        disabled={!hasTraceKey}
                                                      >
                                                        {traceFolded ? (
                                                          <>
                                                            <ChevronRight className="h-3.5 w-3.5" />
                                                            展开
                                                          </>
                                                        ) : (
                                                          <>
                                                            <ChevronDown className="h-3.5 w-3.5" />
                                                            折叠
                                                          </>
                                                        )}
                                                      </Button>
                                                    </div>
                                                  </div>
                                                  {traceLoading ? (
                                                    <div className="px-3 py-3 text-xs text-[#8f959e]">正在加载...</div>
                                                  ) : traceError ? (
                                                    <div className="px-3 py-3 text-xs text-red-500">{traceError}</div>
                                                  ) : traceItems.length > 0 ? (
                                                    !traceFolded && (
                                                      <div className="overflow-x-auto border-t border-[#e8eaed]">
                                                        <table className="w-full text-xs">
                                                          <thead className="bg-[white] text-[#8f959e]">
                                                            <tr>
                                                              <th className="px-3 py-2 text-left font-medium">BOM编号</th>
                                                              <th className="px-3 py-2 text-left font-medium">BOM代码</th>
                                                              <th className="px-3 py-2 text-left font-medium">BOM名称</th>
                                                              <th className="px-3 py-2 text-right font-medium">用量</th>
                                                              <th className="px-3 py-2 text-left font-medium">审核日期</th>
                                                              <th className="px-3 py-2 text-right font-medium">操作</th>
                                                            </tr>
                                                          </thead>
                                                          <tbody className="divide-y divide-[#e8eaed]">
                                                            {traceItems.map((trace, index) => (
                                                              <tr key={`${trace.bomNumber || trace.bomCode}-${index}`}>
                                                                <td className="px-3 py-2">
                                                                  <span className="text-[#1f2329] font-mono">
                                                                    {trace.bomNumber || "—"}
                                                                  </span>
                                                                </td>
                                                                <td className="px-3 py-2">
                                                                  <span className="text-[#1f2329]">
                                                                    {trace.bomCode || "—"}
                                                                  </span>
                                                                </td>
                                                                <td className="px-3 py-2">
                                                                  <span className="text-[#1f2329]">
                                                                    {trace.bomName || "—"}
                                                                  </span>
                                                                </td>
                                                                <td className="px-3 py-2 text-right">
                                                                  <span className="text-[#1f2329]">
                                                                    {formatQtyValue(trace.auxQty || 0)}
                                                                  </span>
                                                                </td>
                                                                <td className="px-3 py-2">
                                                                  <span className="text-[#1f2329]">
                                                                    {formatDateValue(trace.audDate)}
                                                                  </span>
                                                                </td>
                                                                <td className="px-3 py-2 text-right">
                                                                  <Button
                                                                    type="button"
                                                                    variant="ghost"
                                                                    size="sm"
                                                                    className="h-7 text-slate-400 hover:text-red-500"
                                                                    onClick={() => removeDiffTraceItem(item.id, index)}
                                                                    disabled={!canCreate}
                                                                  >
                                                                    删除
                                                                  </Button>
                                                                </td>
                                                              </tr>
                                                            ))}
                                                          </tbody>
                                                        </table>
                                                      </div>
                                                    )
                                                  ) : (
                                                    <div className="px-3 py-3 text-xs text-[#8f959e]">未找到关联BOM</div>
                                                  )}
                                                </div>
                                              </td>
                                            </tr>
                                          )}
                                        </Fragment>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            ) : (
                              <div className="px-3 py-4 text-center text-xs text-[#8f959e]">暂无明细</div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                      </>
                    )}

                    {formData.bomChangeType === "rawMaterialReplace" && (
                      <>
                    <div className="rounded-xl border border-[#e8eaed] overflow-hidden">
                      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-[#e8eaed] bg-[#f8f9fb]">
                        <div className="text-sm font-medium text-[#1f2329]">原材料替换</div>
                        <Button type="button" variant="outline" size="sm" className="h-8" onClick={addAdjustmentItem} disabled={!canCreate}>
                          新增行
                        </Button>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-[#f8f9fb] text-xs text-[#8f959e]">
                            <tr>
                              <th className="px-4 py-2 text-left font-medium">替换自编码</th>
                              <th className="px-4 py-2 text-left font-medium">替换自名称</th>
                              <th className="px-4 py-2 text-left font-medium">替换为编码</th>
                              <th className="px-4 py-2 text-left font-medium">替换为名称</th>
                              <th className="px-4 py-2 text-right font-medium">操作</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#e8eaed]">
                            {formData.bomMaterialAdjustments && formData.bomMaterialAdjustments.length > 0 ? (
                              formData.bomMaterialAdjustments.map((item) => {
                                const traceItems = rawReplaceBomMap[item.id] || [];
                                const traceLoading = rawReplaceBomLoading[item.id];
                                const traceError = rawReplaceBomError[item.id];
                                const traceFolded = rawReplaceBomFolded[item.id];
                                const traceEntryId = rawReplaceItemIdMap[item.id];
                                const hasTraceKey = Object.prototype.hasOwnProperty.call(
                                  rawReplaceBomMap,
                                  item.id
                                );
                                const showTrace = traceLoading || Boolean(traceError) || hasTraceKey;
                                return (
                                  <Fragment key={item.id}>
                                    <tr className="bg-[white]">
                                      <td className="px-4 py-2">
                                        <div className="flex items-center gap-2">
                                          <Input
                                            value={item.replaceFromCode}
                                            onChange={(event) => updateAdjustmentItem(item.id, "replaceFromCode", event.target.value)}
                                            className="h-9"
                                            placeholder="如：MAT-001"
                                            disabled={!canCreate}
                                          />
                                          <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="h-8"
                                            onClick={() => openMaterialModal(item.id, "from")}
                                            disabled={!canCreate}
                                          >
                                            选择
                                          </Button>
                                        </div>
                                      </td>
                                      <td className="px-4 py-2">
                                        <Input
                                          value={item.replaceFromName}
                                          onChange={(event) => updateAdjustmentItem(item.id, "replaceFromName", event.target.value)}
                                          className="h-9"
                                          placeholder="物料名称"
                                          disabled={!canCreate}
                                        />
                                      </td>
                                      <td className="px-4 py-2">
                                        <div className="flex items-center gap-2">
                                          <Input
                                            value={item.replaceToCode}
                                            onChange={(event) => updateAdjustmentItem(item.id, "replaceToCode", event.target.value)}
                                            className="h-9"
                                            placeholder="如：MAT-002"
                                            disabled={!canCreate}
                                          />
                                          <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="h-8"
                                            onClick={() => openMaterialModal(item.id, "to")}
                                            disabled={!canCreate}
                                          >
                                            选择
                                          </Button>
                                        </div>
                                      </td>
                                      <td className="px-4 py-2">
                                        <Input
                                          value={item.replaceToName}
                                          onChange={(event) => updateAdjustmentItem(item.id, "replaceToName", event.target.value)}
                                          className="h-9"
                                          placeholder="物料名称"
                                          disabled={!canCreate}
                                        />
                                      </td>
                                      <td className="px-4 py-2 text-right">
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="sm"
                                          className="text-slate-400 hover:text-red-500"
                                          onClick={() => removeAdjustmentItem(item.id)}
                                          disabled={!canCreate}
                                        >
                                          删除
                                        </Button>
                                      </td>
                                    </tr>
                                    {showTrace && (
                                      <tr className="bg-[white]">
                                        <td colSpan={5} className="px-4 pb-4">
                                          <div className="rounded-lg border border-[#e8eaed] bg-[#f8f9fb]">
                                            <div className="flex items-center justify-between px-3 py-2 text-xs text-[#8f959e]">
                                              <span>关联BOM</span>
                                            <div className="flex items-center gap-2">
                                              <span>共 {traceItems.length} 条</span>
                                              <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                className="h-7"
                                                onClick={() => traceEntryId && loadRawReplaceBoms(item.id, traceEntryId)}
                                                disabled={!traceEntryId || traceLoading}
                                              >
                                                刷新
                                              </Button>
                                              <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                className="h-7"
                                                  onClick={() => toggleRawReplaceFold(item.id)}
                                                >
                                                  {traceFolded ? (
                                                    <>
                                                      <ChevronRight className="h-3.5 w-3.5" />
                                                      展开
                                                    </>
                                                  ) : (
                                                    <>
                                                      <ChevronDown className="h-3.5 w-3.5" />
                                                      折叠
                                                    </>
                                                  )}
                                                </Button>
                                              </div>
                                            </div>
                                            {traceLoading ? (
                                              <div className="px-3 py-3 text-xs text-[#8f959e]">正在加载...</div>
                                            ) : traceError ? (
                                              <div className="px-3 py-3 text-xs text-rose-500">{traceError}</div>
                                            ) : traceFolded ? (
                                              <div className="px-3 py-3 text-xs text-[#8f959e]">已折叠</div>
                                            ) : traceItems.length > 0 ? (
                                              <div className="overflow-x-auto">
                                                <table className="w-full text-xs">
                                                  <thead className="bg-[white] text-[#8f959e]">
                                                    <tr>
                                                      <th className="px-3 py-2 text-left font-medium">BOM编号</th>
                                                      <th className="px-3 py-2 text-left font-medium">BOM代码</th>
                                                      <th className="px-3 py-2 text-left font-medium">BOM名称</th>
                                                      <th className="px-3 py-2 text-right font-medium">用量</th>
                                                      <th className="px-3 py-2 text-left font-medium">审核日期</th>
                                                      <th className="px-3 py-2 text-right font-medium">操作</th>
                                                    </tr>
                                                  </thead>
                                                  <tbody className="divide-y divide-[#e8eaed]">
                                                    {traceItems.map((trace, index) => (
                                                      <tr key={`${trace.bomNumber || trace.bomCode}-${index}`}>
                                                        <td className="px-3 py-2">
                                                          <span className="text-[#1f2329] font-mono">
                                                            {trace.bomNumber || "—"}
                                                          </span>
                                                        </td>
                                                        <td className="px-3 py-2">
                                                          <span className="text-[#1f2329] font-mono">
                                                            {trace.bomCode || "—"}
                                                          </span>
                                                        </td>
                                                        <td className="px-3 py-2">
                                                          <span className="text-[#1f2329]">
                                                            {trace.bomName || "—"}
                                                          </span>
                                                        </td>
                                                        <td className="px-3 py-2 text-right">
                                                          <span className="text-[#1f2329]">
                                                            {formatQtyValue(trace.auxQty || 0)}
                                                          </span>
                                                        </td>
                                                        <td className="px-3 py-2">
                                                          <span className="text-[#1f2329]">
                                                            {formatDateValue(trace.audDate)}
                                                          </span>
                                                        </td>
                                                        <td className="px-3 py-2 text-right">
                                                          <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="sm"
                                                            className="h-7 text-slate-400 hover:text-red-500"
                                                            onClick={() => removeRawReplaceBom(item.id, index)}
                                                            disabled={!canCreate}
                                                          >
                                                            删除
                                                          </Button>
                                                        </td>
                                                      </tr>
                                                    ))}
                                                  </tbody>
                                                </table>
                                              </div>
                                            ) : (
                                              <div className="px-3 py-3 text-xs text-[#8f959e]">未找到关联BOM</div>
                                            )}
                                          </div>
                                        </td>
                                      </tr>
                                    )}
                                  </Fragment>
                                );
                              })
                            ) : (
                              <tr>
                                <td colSpan={5} className="px-4 py-6 text-center text-[#8f959e]">
                                  暂无变更项
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                    </div>
                  </div>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    {selectedProjectId ? (
                      <div className="rounded-xl border border-[#e8eaed] bg-[white] overflow-hidden">
                        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-[#e8eaed] bg-[#f8f9fb]">
                          <div>
                            <div className="text-sm font-medium text-[#1f2329]">费用关联模拟</div>
                            <div className="text-xs text-[#8f959e]">材料替换节省与设备/模具投入合并测算</div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-[#8f959e]">
                            <span className="rounded-full border border-[#e8eaed] bg-[white] px-2 py-0.5">
                              材料差额：{formatMoney(baseTotal - targetTotal)}
                            </span>
                            <span className="rounded-full border border-[#e8eaed] bg-[white] px-2 py-0.5">
                              关联OA：{costLinkItems.length} 项
                            </span>
                          </div>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead className="bg-[#f8f9fb] text-xs text-[#8f959e]">
                              <tr>
                                <th className="px-4 py-2 text-left font-medium">费用项</th>
                                <th className="px-4 py-2 text-left font-medium">类别</th>
                                <th className="px-4 py-2 text-left font-medium">OA单号</th>
                                <th className="px-4 py-2 text-left font-medium">备注</th>
                                <th className="px-4 py-2 text-right font-medium">金额</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[#e8eaed]">
                              {costLinkItems.map((item) => (
                                <tr key={item.id} className="bg-[white]">
                                  <td className="px-4 py-2">{item.name}</td>
                                  <td className="px-4 py-2">{item.category}</td>
                                  <td className="px-4 py-2">{item.oaProject}</td>
                                  <td className="px-4 py-2">{item.note}</td>
                                  <td className={`px-4 py-2 text-right font-medium ${item.amount >= 0 ? "text-emerald-600" : "text-rose-500"}`}>
                                    {formatMoney(item.amount)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div className="flex items-center justify-between px-4 py-3 text-sm border-t border-[#e8eaed]">
                          <span className="text-[#1f2329] font-medium">费用净影响</span>
                          <span className={`font-semibold ${costLinkTotal >= 0 ? "text-emerald-600" : "text-rose-500"}`}>
                            {formatMoney(costLinkTotal)}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-xl border border-[#e8eaed] bg-[#f8f9fb] p-6 text-center text-sm text-[#8f959e]">
                        请选择项目查看费用关联模拟
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

          </form>
        </div>
      </main>

      {/* Database Selection Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-4xl rounded-xl bg-[white] shadow-2xl flex flex-col max-h-[85vh] animate-in fade-in zoom-in duration-200">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-[#e8eaed] px-6 py-4">
              <div>
                <h2 className="text-lg font-semibold text-[#1f2329]">
                  {bomSelectMode === "base" ? "选择关联 BOM" : "选择变更后 BOM"}
                </h2>
                <p className="text-sm text-[#8f959e]">
                  {bomSelectMode === "base" ? "用于关联基础 BOM 编号" : "用于替换后的目标 BOM 编号"}
                </p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setIsModalOpen(false)}>
                <X className="h-5 w-5" />
              </Button>
            </div>

            {/* Search Bar */}
            <div className="p-4 border-b border-[#e8eaed] bg-[#f8f9fb]">
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <Input 
                  className="pl-9 bg-[#f8f9fb]" 
                  placeholder="输入编码、名称或关键词搜索..." 
                  value={formTemplateQuery}
                  onChange={(e) => setFormTemplateQuery(e.target.value)}
                  autoFocus
                />
              </div>
            </div>

            {/* Content List */}
            <div className="flex-1 overflow-y-auto p-4">
              {isLoadingTemplates ? (
                <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                  <Loader2 className="h-8 w-8 animate-spin mb-3" />
                  <p>正在从数据库加载数据...</p>
                </div>
              ) : templateError ? (
                <div className="text-center py-12 text-red-500">
                  <p>{templateError}</p>
                  <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
                    <Button variant="outline" onClick={handleReloadTemplates}>重新加载</Button>
                    {templateError.includes("未配置") && currentUser?.role === "admin" && (
                      <Button onClick={() => router.push("/admin/settings")}>前往系统设置</Button>
                    )}
                  </div>
                </div>
              ) : formTemplates.length === 0 ? (
                <div className="text-center py-12 text-[#8f959e]">
                  <Database className="h-12 w-12 mx-auto mb-3 opacity-20" />
                  <p>未找到匹配的数据</p>
                  <p className="text-xs mt-1">请尝试更换关键词搜索</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-2">
                  {formTemplates.map((template) => (
                    <div 
                      key={template.id}
                      onClick={() => handleSelectFromModal(template)}
                      className="group flex items-center justify-between p-4 rounded-lg border border-[#e8eaed] hover:border-blue-500 hover:bg-blue-50/50 cursor-pointer transition-all"
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-[#1f2329] group-hover:text-blue-600">
                            {template.name}
                          </span>
                          {template.version && (
                            <span className="px-1.5 py-0.5 rounded text-xs bg-slate-100 text-slate-500">
                              v{template.version}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-4 text-xs text-[#8f959e]">
                          <span className="font-mono">BOM: {template.bomNumber || template.id}</span>
                          <span className="font-mono">编号: {template.code}</span>
                          <span>{template.createdAt.split('T')[0]}</span>
                        </div>
                      </div>
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button size="sm" className="h-8 gap-1">
                          选择
                          <Check className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="border-t border-[#e8eaed] px-6 py-3 bg-[#f8f9fb] flex justify-between items-center text-xs text-[#8f959e]">
              <span>共找到 {formTemplates.length} 条记录</span>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setIsModalOpen(false)}>取消</Button>
              </div>
            </div>
          </div>
        </div>
      )}
      {isProjectFormModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-4xl rounded-xl bg-[white] shadow-2xl flex flex-col max-h-[85vh] animate-in fade-in zoom-in duration-200">
            <div className="flex items-center justify-between border-b border-[#e8eaed] px-6 py-4">
              <div>
                <h2 className="text-lg font-semibold text-[#1f2329]">选择立项表</h2>
                <p className="text-sm text-[#8f959e]">用于快速填充项目基础信息</p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setIsProjectFormModalOpen(false)}>
                <X className="h-5 w-5" />
              </Button>
            </div>
            <div className="p-4 border-b border-[#e8eaed] bg-[#f8f9fb]">
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <Input
                  className="pl-9 bg-[#f8f9fb]"
                  placeholder="输入立项表编码、名称或关键词搜索..."
                  value={projectFormQuery}
                  onChange={(e) => setProjectFormQuery(e.target.value)}
                  autoFocus
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {isLoadingProjectForms ? (
                <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                  <Loader2 className="h-8 w-8 animate-spin mb-3" />
                  <p>正在加载立项表...</p>
                </div>
              ) : projectFormError ? (
                <div className="text-center py-12 text-red-500">
                  <p>{projectFormError}</p>
                  <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
                    <Button variant="outline" onClick={handleReloadProjectForms}>重新加载</Button>
                    {projectFormError.includes("未配置") && currentUser?.role === "admin" && (
                      <Button onClick={() => router.push("/admin/settings")}>前往系统设置</Button>
                    )}
                  </div>
                </div>
              ) : projectForms.length === 0 ? (
                <div className="text-center py-12 text-[#8f959e]">
                  <Database className="h-12 w-12 mx-auto mb-3 opacity-20" />
                  <p>未找到匹配的立项表</p>
                  <p className="text-xs mt-1">请尝试更换关键词搜索</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-2">
                  {projectForms.map((template) => (
                    <div
                      key={template.id}
                      onClick={() => handleSelectProjectForm(template)}
                      className="group flex items-center justify-between p-4 rounded-lg border border-[#e8eaed] hover:border-emerald-500 hover:bg-emerald-50/50 cursor-pointer transition-all"
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-[#1f2329] group-hover:text-emerald-600">
                            {template.name}
                          </span>
                          {template.version && (
                            <span className="px-1.5 py-0.5 rounded text-xs bg-slate-100 text-slate-500">
                              v{template.version}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-4 text-xs text-[#8f959e]">
                          <span className="font-mono">编号: {template.code}</span>
                          <span className="font-mono">单号: {template.bomNumber || template.id}</span>
                          <span>{template.createdAt.split("T")[0]}</span>
                        </div>
                      </div>
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button size="sm" className="h-8 gap-1">
                          选择
                          <Check className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="border-t border-[#e8eaed] px-6 py-3 bg-[#f8f9fb] flex justify-between items-center text-xs text-[#8f959e]">
              <span>共找到 {projectForms.length} 条记录</span>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setIsProjectFormModalOpen(false)}>
                  取消
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
      {isMaterialModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-4xl rounded-xl bg-[white] shadow-2xl flex flex-col max-h-[85vh] animate-in fade-in zoom-in duration-200">
            <div className="flex items-center justify-between border-b border-[#e8eaed] px-6 py-4">
              <div>
                <h2 className="text-lg font-semibold text-[#1f2329]">
                  {materialSelectMode === "from" ? "选择替换前物料" : "选择替换后物料"}
                </h2>
                <p className="text-sm text-[#8f959e]">
                  {materialSelectMode === "from" ? "用于替换原物料" : "用于替换目标物料"}
                </p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setIsMaterialModalOpen(false)}>
                <X className="h-5 w-5" />
              </Button>
            </div>
            <div className="p-4 border-b border-[#e8eaed] bg-[#f8f9fb]">
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <Input
                  className="pl-9 bg-[#f8f9fb]"
                  placeholder="输入物料编码或名称搜索..."
                  value={materialQuery}
                  onChange={(e) => setMaterialQuery(e.target.value)}
                  autoFocus
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {isLoadingMaterials ? (
                <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                  <Loader2 className="h-8 w-8 animate-spin mb-3" />
                  <p>正在从数据库加载物料...</p>
                </div>
              ) : materialError ? (
                <div className="text-center py-12 text-red-500">
                  <p>{materialError}</p>
                </div>
              ) : materialOptions.length === 0 ? (
                <div className="text-center py-12 text-[#8f959e]">
                  <Database className="h-12 w-12 mx-auto mb-3 opacity-20" />
                  <p>未找到匹配的物料</p>
                  <p className="text-xs mt-1">请尝试更换关键词搜索</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-2">
                  {materialOptions.map((material) => (
                    <div
                      key={`${material.entryId}-${material.materialCode}-${material.materialName}`}
                      onClick={() => handleSelectMaterial(material)}
                      className="group flex items-center justify-between p-4 rounded-lg border border-[#e8eaed] hover:border-blue-500 hover:bg-blue-50/50 cursor-pointer transition-all"
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-[#1f2329] group-hover:text-blue-600">
                            {material.materialName || "未命名物料"}
                          </span>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-[#8f959e]">
                          <span className="font-mono">编码: {material.materialCode || "—"}</span>
                          <span>单位: {material.unit || "—"}</span>
                          <span>标准价: {formatMoney(material.unitPrice || 0)}</span>
                        </div>
                      </div>
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button size="sm" className="h-8 gap-1">
                          选择
                          <Check className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="border-t border-[#e8eaed] px-6 py-3 bg-[#f8f9fb] flex justify-between items-center text-xs text-[#8f959e]">
              <span>共找到 {materialOptions.length} 条记录</span>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setIsMaterialModalOpen(false)}>
                  取消
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
      {renderCustDiffPicker()}
    </div>
  );
}
