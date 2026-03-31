"use client";

import { Suspense, startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Home, CheckCircle2, Circle, Plus, Trash2, LayoutDashboard, TrendingDown, ListTodo, Calendar, Users, Target, FileText, ChevronDown, ChevronRight, GripVertical, FileSpreadsheet, Upload, Download, Loader2, ArrowRight, RefreshCw, Minus, History, Clock, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/Tabs";
import { departments } from "@/lib/data";
import { BomDiffItem, PricingColumn, PricingDiff, PricingLog, PricingSheet, PricingSheetSummary, Project, Task, User } from "@/types";
import { cn } from "@/lib/utils";

type BenefitDebug = {
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

type BenefitSummary = {
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

type ProjectMeasure = {
  mainId: string;
  mainAction: string;
  description: string;
  responsiblePerson: string;
};

export default function ProjectDetailPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#f5f6f8] flex items-center justify-center text-[#8f959e]">
        <div className="flex flex-col items-center gap-2">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#3370ff]"></div>
          <p>正在加载项目...</p>
        </div>
      </div>
    }>
      <ProjectDetail />
    </Suspense>
  );
}

function ProjectDetail() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = params.id as string;

  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [measures, setMeasures] = useState<ProjectMeasure[]>([]);
  const [measuresLoading, setMeasuresLoading] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [benefitDebug, setBenefitDebug] = useState<BenefitDebug | null>(null);
  const [benefitSummary, setBenefitSummary] = useState<BenefitSummary | null>(null);
  const [diffTraceFoldedMap, setDiffTraceFoldedMap] = useState<Record<number, boolean>>({});
  const [diffTraceLoadingMap, setDiffTraceLoadingMap] = useState<Record<number, boolean>>({});
  const [diffTraceErrorMap, setDiffTraceErrorMap] = useState<Record<number, string>>({});
  const autoTraceLoadRef = useRef<Set<string>>(new Set());
  const [isDiffOpen, setIsDiffOpen] = useState(true);
  const [activeTab, setActiveTab] = useState("overview");
  const [visitedTabs, setVisitedTabs] = useState<Set<string>>(new Set(["overview"]));
  /* pricing tab state */
  const [pricingList, setPricingList] = useState<PricingSheetSummary[]>([]);
  const [pricingSelectedId, setPricingSelectedId] = useState("");
  const [pricingDetail, setPricingDetail] = useState<PricingSheet | null>(null);
  const [pricingLoading, setPricingLoading] = useState(false);
  const [pricingDetailLoading, setPricingDetailLoading] = useState(false);
  const [pricingFile, setPricingFile] = useState<File | null>(null);
  const [pricingUploading, setPricingUploading] = useState(false);
  const [pricingMsg, setPricingMsg] = useState("");
  const [pricingShowAllMainColumns, setPricingShowAllMainColumns] = useState(false);
  const [pricingShowAllDiffColumns, setPricingShowAllDiffColumns] = useState(false);
  const [pricingLogs, setPricingLogs] = useState<PricingLog[]>([]);
  const [pricingLogsLoading, setPricingLogsLoading] = useState(false);
  const [pricingLogsOpen, setPricingLogsOpen] = useState(false);
  const [pricingVersionsOpen, setPricingVersionsOpen] = useState(false);
  const pricingFileRef = useRef<HTMLInputElement>(null);
  const dragStateRef = useRef<{ group: "base" | "target" | null; id: string | null }>({
    group: null,
    id: null,
  });
  const [diffOrderByProject, setDiffOrderByProject] = useState<
    Record<string, { base: string[]; target: string[] }>
  >({});
  const [orderSaveState, setOrderSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const debugMode =
    searchParams.get("debug") === "1" || searchParams.get("debug") === "true";

  // ... existing auth logic ...
  const canViewProject = (user: User, item: Project) => {
    if (user.role === "admin") return true;
    return item.departmentId === user.departmentId;
  };

  const canEditTask = (user: User, item: Project) => {
    if (user.role === "admin") return true;
    return item.departmentId === user.departmentId;
  };

  const formatQtyValue = (value: number) => (Number.isFinite(value) ? String(value) : "0");
  const formatDateValue = (value?: string) => {
    if (!value || !value.trim()) return "-";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.valueOf())) return value;
    return parsed.toLocaleDateString("zh-CN");
  };
  const formatMoney = (value?: number | null) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return "-";
    return new Intl.NumberFormat("zh-CN", {
      style: "currency",
      currency: "CNY",
      maximumFractionDigits: 2,
    }).format(value);
  };
  const formatPercent = (value?: number | null) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return "-";
    return `${value.toFixed(2)}%`;
  };
  const readString = useCallback((value: unknown) => {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value.trim();
    return String(value).trim();
  }, []);
  const readNumber = useCallback((value: unknown) => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
  }, []);
  const normalizeTraceBoms = useCallback((value: unknown) => {
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
      .filter((item): item is { bomNumber: string; bomCode: string; bomName: string; auxQty: number; audDate: string } =>
        Boolean(item)
      );
  }, [readNumber, readString]);
  const getDiffOrderKey = (item: BomDiffItem) =>
    [item.itemId?.trim(), item.materialCode?.trim(), item.materialName?.trim()]
      .filter(Boolean)
      .join("::");

  const handleAddTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!allowEdit) return;
    if (!newTaskTitle.trim()) return;
    void (async () => {
      setErrorMessage("");
      const response = await fetch(`/api/projects/${id}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTaskTitle.trim() }),
      });
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      if (!response.ok) {
        setErrorMessage("新增任务失败");
        return;
      }
      const task = (await response.json()) as Task;
      setTasks((prev) => [task, ...prev]);
      setNewTaskTitle("");
    })();
  };

  const toggleTask = (taskId: string) => {
    if (!allowEdit) return;
    void (async () => {
      setErrorMessage("");
      const response = await fetch(`/api/tasks/${taskId}`, { method: "PATCH" });
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      if (!response.ok) {
        setErrorMessage("更新任务状态失败");
        return;
      }
      const updated = (await response.json()) as Task;
      setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    })();
  };

  const deleteTask = (taskId: string) => {
    if (!allowEdit) return;
    void (async () => {
      setErrorMessage("");
      const response = await fetch(`/api/tasks/${taskId}`, { method: "DELETE" });
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      if (!response.ok) {
        setErrorMessage("删除任务失败");
        return;
      }
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
    })();
  };

  const loadMeasures = useCallback(async (projectForMeasure?: Project | null) => {
    if (!id) return;
    setMeasuresLoading(true);
    try {
      const mainId = id;
      const altMainId = projectForMeasure?.formTemplateId || "";
      const response = await fetch(
        `/api/project-measures?mainId=${encodeURIComponent(mainId)}&altMainId=${encodeURIComponent(altMainId)}&projectName=${encodeURIComponent(projectForMeasure?.name || "")}&salesOrderNo=${encodeURIComponent(projectForMeasure?.salesOrderNo || "")}`
      );
      if (response.ok) {
        const data = await response.json() as { measures?: ProjectMeasure[] };
        setMeasures(data.measures || []);
      } else {
        console.error("Failed to load measures");
        setMeasures([]);
      }
    } catch (error) {
      console.error("Error loading measures:", error);
      setMeasures([]);
    } finally {
      setMeasuresLoading(false);
    }
  }, [id]);

  useEffect(() => {
    let active = true;
    const loadData = async () => {
      if (!active) return;
      setIsLoading(true);
      setErrorMessage("");
      try {
        const [meResponse, projectResponse] = await Promise.all([
          fetch("/api/auth/me"),
          fetch(debugMode ? `/api/projects/${id}?debug=1` : `/api/projects/${id}`),
        ]);
        if (!active) return;
        if (meResponse.status === 401 || projectResponse.status === 401) {
          setErrorMessage("未登录，正在跳转...");
          router.replace("/login");
          return;
        }
        if (!meResponse.ok) {
          setErrorMessage("加载用户信息失败");
          setIsLoading(false);
          return;
        }
        if (projectResponse.status === 403) {
          setErrorMessage("无权限查看该项目");
          setIsLoading(false);
          return;
        }
        if (projectResponse.status === 404) {
          setErrorMessage("项目不存在");
          setIsLoading(false);
          return;
        }
        if (!projectResponse.ok) {
          setErrorMessage("加载项目失败");
          setIsLoading(false);
          return;
        }
        const [user, projectData] = await Promise.all([
          meResponse.json() as Promise<User>,
          projectResponse.json() as Promise<{
            project: Project;
            tasks: Task[];
            benefitDebug?: BenefitDebug | null;
            benefitSummary?: BenefitSummary | null;
          }>,
        ]);
        if (!active) return;
        // 先触发措施加载（在 startTransition 之前，避免被 defer 影响）
        void loadMeasures(projectData.project);
        // 用 startTransition 让大批 setState 以低优先级渲染，避免阻塞主线程
        startTransition(() => {
          setCurrentUser(user);
          setProject(projectData.project);
          setTasks(projectData.tasks);
          setBenefitDebug(projectData.benefitDebug ?? null);
          setBenefitSummary(projectData.benefitSummary ?? null);
          setIsLoading(false);
        });
      } catch (error) {
        if (!active) return;
        console.error("Failed to load project data:", error);
        setErrorMessage("网络异常，加载失败");
        setIsLoading(false);
      }
    };
    loadData();
    return () => {
      active = false;
    };
  }, [debugMode, id, router, loadMeasures]);

  const isAllowed = currentUser && project ? canViewProject(currentUser, project) : false;
  const allowEdit = currentUser && project ? canEditTask(currentUser, project) : false;

  const normalizeTaskTitle = useCallback((value: string) => value.replace(/\s+/g, " ").trim().toLowerCase(), []);
  const toMeasureTaskTitle = useCallback((measure: ProjectMeasure) => {
    const main = (measure.mainAction || "").trim();
    const desc = (measure.description || "").trim();
    if (main && desc) return `${main} - ${desc}`;
    return main || desc || "未命名措施";
  }, []);
  const measureTaskDrafts = useMemo(
    () =>
      measures.map((measure, index) => ({
        id: `${measure.mainId || id}-m-${index}`,
        title: toMeasureTaskTitle(measure),
        mainAction: measure.mainAction,
        description: measure.description,
        responsiblePerson: measure.responsiblePerson,
      })),
    [id, measures, toMeasureTaskTitle]
  );
  const taskTitleSet = useMemo(
    () => new Set(tasks.map((task) => normalizeTaskTitle(task.title || ""))),
    [normalizeTaskTitle, tasks]
  );
  const pendingMeasureTaskDrafts = useMemo(
    () => measureTaskDrafts.filter((item) => !taskTitleSet.has(normalizeTaskTitle(item.title))),
    [measureTaskDrafts, normalizeTaskTitle, taskTitleSet]
  );
  const taskSummary = useMemo(() => {
    const total = tasks.length;
    const done = tasks.filter((task) => task.completed).length;
    return { total, done, pending: Math.max(0, total - done) };
  }, [tasks]);
  const displayTasks = useMemo(
    () =>
      [...tasks].sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        return (a.title || "").localeCompare(b.title || "", "zh-CN");
      }),
    [tasks]
  );
  const syncMeasureTasks = useCallback(() => {
    if (!allowEdit || !id || pendingMeasureTaskDrafts.length === 0) return;
    void (async () => {
      setErrorMessage("");
      const created: Task[] = [];
      for (const draft of pendingMeasureTaskDrafts) {
        const response = await fetch(`/api/projects/${id}/tasks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: draft.title }),
        });
        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        if (!response.ok) {
          setErrorMessage("同步实施措施到任务清单失败");
          return;
        }
        created.push((await response.json()) as Task);
      }
      if (created.length > 0) {
        setTasks((prev) => [...created, ...prev]);
      }
    })();
  }, [allowEdit, id, pendingMeasureTaskDrafts, router]);

  const diffItems = useMemo(
    () => (Array.isArray(project?.bomDiffItems) ? project?.bomDiffItems ?? [] : []),
    [project?.bomDiffItems]
  );
  const visibleDiffItems = diffItems
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => Number(item.delta ?? 0) !== 0);
  const diffTraceGroups = useMemo(
    () => (Array.isArray(project?.bomDiffTraceItems) ? project?.bomDiffTraceItems ?? [] : []),
    [project?.bomDiffTraceItems]
  );
  const benefitSource = benefitDebug ?? benefitSummary;
  const rawDetailLines =
    benefitDebug?.sampleLines && benefitDebug.sampleLines.length > 0
      ? benefitDebug.sampleLines
      : benefitSummary?.detailLines ?? [];
  const detailRows = rawDetailLines.map((line, index) => {
    const qty = Number(line.qty || 0);
    const currentTotal = Number(line.costAmount || 0);
    const currentUnitCost = qty > 0 ? currentTotal / qty : null;
    const baseUnitCost = benefitSource?.lastCostUnitCost ?? null;
    const baseTotal = typeof baseUnitCost === "number" ? baseUnitCost * qty : null;
    const savings = typeof baseTotal === "number" ? baseTotal - currentTotal : null;
    return {
      key: `${line.materialCode || "row"}-${index}`,
      materialCode: line.materialCode,
      materialName: line.materialName,
      qty,
      baseUnitCost,
      currentUnitCost,
      baseTotal,
      currentTotal,
      savings,
    };
  });
  const financeSummary = (() => {
    if (!benefitSource?.totals) return null;
    const baseCost = Number(benefitSource.totals.baseCostAmount || 0);
    const currentCost = Number(benefitSource.totals.costAmount || 0);
    const salesAmount = Number(benefitSource.totals.salesAmount || 0);
    const totalQty = Number(benefitSource.totals.totalQty || 0);
    const savings = baseCost - currentCost;
    const savingsRate = baseCost > 0 ? (savings / baseCost) * 100 : null;
    const unitCost = totalQty > 0 ? currentCost / totalQty : null;
    return {
      baseCost,
      currentCost,
      salesAmount,
      totalQty,
      unitCost,
      savings,
      savingsRate,
      benefitText: benefitSource.totals.benefitText,
    };
  })();
  const orderNoTokens = project?.salesOrderNo
    ? project.salesOrderNo.split(/[\s,;，、]+/g).map((item) => item.trim()).filter(Boolean)
    : [];
  const activeProjectId = project?.id ?? "";
  const baseOnlyOrder = useMemo(() => {
    const persisted = Array.isArray(project?.bomDiffBaseOrder) ? project?.bomDiffBaseOrder : [];
    return diffOrderByProject[activeProjectId]?.base ?? persisted;
  }, [activeProjectId, diffOrderByProject, project?.bomDiffBaseOrder]);
  const targetOnlyOrder = useMemo(() => {
    const persisted = Array.isArray(project?.bomDiffTargetOrder) ? project?.bomDiffTargetOrder : [];
    return diffOrderByProject[activeProjectId]?.target ?? persisted;
  }, [activeProjectId, diffOrderByProject, project?.bomDiffTargetOrder]);

  const diffGroups = {
    baseOnly: visibleDiffItems.filter(({ item }) => Number(item.baseQty || 0) > 0 && Number(item.targetQty || 0) === 0),
    targetOnly: visibleDiffItems.filter(({ item }) => Number(item.targetQty || 0) > 0 && Number(item.baseQty || 0) === 0),
    changed: visibleDiffItems.filter(({ item }) => Number(item.baseQty || 0) > 0 && Number(item.targetQty || 0) > 0),
  };
  const loadDiffTraceBoms = useCallback(
    (diffIndex: number, itemId: string) => {
    if (!itemId?.trim()) return;
    setDiffTraceLoadingMap((prev) => ({ ...prev, [diffIndex]: true }));
    setDiffTraceErrorMap((prev) => ({ ...prev, [diffIndex]: "" }));
    void (async () => {
      const response = await fetch(`/api/materials?itemId=${encodeURIComponent(itemId)}`, { cache: "no-store" });
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      if (!response.ok) {
        setDiffTraceErrorMap((prev) => ({ ...prev, [diffIndex]: "加载关联BOM失败" }));
        return;
      }
      const data = (await response.json()) as { boms?: unknown };
      const next = normalizeTraceBoms(data?.boms);
      const nextGroups = diffTraceGroups.map((group) => (Array.isArray(group) ? group : []));
      while (nextGroups.length < diffItems.length) {
        nextGroups.push([]);
      }
      nextGroups[diffIndex] = next;
      const saveResponse = await fetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bomDiffItems: diffItems,
          bomDiffTraceItems: nextGroups,
        }),
      });
      if (saveResponse.status === 401) {
        router.replace("/login");
        return;
      }
      if (saveResponse.status === 403) {
        setErrorMessage("无权限保存关联BOM");
        return;
      }
      if (!saveResponse.ok) {
        setErrorMessage("保存关联BOM失败");
        return;
      }
      const updated = (await saveResponse.json()) as Project;
      setProject(updated);
    })()
      .catch(() => {
        setDiffTraceErrorMap((prev) => ({ ...prev, [diffIndex]: "网络异常，加载失败" }));
      })
      .finally(() => {
        setDiffTraceLoadingMap((prev) => ({ ...prev, [diffIndex]: false }));
      });
    },
    [diffItems, diffTraceGroups, id, normalizeTraceBoms, router]
  );

  const orderedBaseOnly = useMemo(() => {
    const current = diffGroups.baseOnly;
    const map = new Map(current.map((entry) => [getDiffOrderKey(entry.item), entry]));
    const seen = new Set<string>();
    const ordered: { item: typeof diffItems[number]; index: number }[] = [];
    baseOnlyOrder.forEach((key) => {
      const entry = map.get(key);
      if (!entry || seen.has(key)) return;
      ordered.push(entry);
      seen.add(key);
    });
    current.forEach((entry) => {
      const key = getDiffOrderKey(entry.item);
      if (seen.has(key)) return;
      ordered.push(entry);
      seen.add(key);
    });
    return ordered;
  }, [diffGroups.baseOnly, baseOnlyOrder]);
  const orderedTargetOnly = useMemo(() => {
    const current = diffGroups.targetOnly;
    const map = new Map(current.map((entry) => [getDiffOrderKey(entry.item), entry]));
    const seen = new Set<string>();
    const ordered: { item: typeof diffItems[number]; index: number }[] = [];
    targetOnlyOrder.forEach((key) => {
      const entry = map.get(key);
      if (!entry || seen.has(key)) return;
      ordered.push(entry);
      seen.add(key);
    });
    current.forEach((entry) => {
      const key = getDiffOrderKey(entry.item);
      if (seen.has(key)) return;
      ordered.push(entry);
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
      setDiffOrderByProject((prev) => {
        const basePrev = prev[activeProjectId]?.base ?? [];
        const seed = diffGroups.baseOnly.map((entry) => getDiffOrderKey(entry.item));
        const base = basePrev.length === seed.length ? basePrev : seed;
        const next = base.filter((id) => id !== sourceId);
        const pos = next.indexOf(targetId);
        next.splice(pos >= 0 ? pos : next.length, 0, sourceId);
        return { ...prev, [activeProjectId]: { base: next, target: prev[activeProjectId]?.target ?? [] } };
      });
    } else {
      setDiffOrderByProject((prev) => {
        const targetPrev = prev[activeProjectId]?.target ?? [];
        const seed = diffGroups.targetOnly.map((entry) => getDiffOrderKey(entry.item));
        const target = targetPrev.length === seed.length ? targetPrev : seed;
        const next = target.filter((id) => id !== sourceId);
        const pos = next.indexOf(targetId);
        next.splice(pos >= 0 ? pos : next.length, 0, sourceId);
        return { ...prev, [activeProjectId]: { base: prev[activeProjectId]?.base ?? [], target: next } };
      });
    }
    dragStateRef.current = { group: null, id: null };
    setOrderSaveState("idle");
  };
  const onDragEnd = () => {
    dragStateRef.current = { group: null, id: null };
  };

  const hasOrderChanges = useMemo(() => {
    if (!project) return false;
    const persistedBase = Array.isArray(project.bomDiffBaseOrder) ? project.bomDiffBaseOrder : [];
    const persistedTarget = Array.isArray(project.bomDiffTargetOrder) ? project.bomDiffTargetOrder : [];
    const sameBase =
      baseOnlyOrder.length === persistedBase.length &&
      baseOnlyOrder.every((value, index) => value === persistedBase[index]);
    const sameTarget =
      targetOnlyOrder.length === persistedTarget.length &&
      targetOnlyOrder.every((value, index) => value === persistedTarget[index]);
    return !(sameBase && sameTarget);
  }, [baseOnlyOrder, project, targetOnlyOrder]);

  const handleSaveOrder = () => {
    if (!project || !currentUser || !allowEdit || !hasOrderChanges) return;
    setOrderSaveState("saving");
    void (async () => {
      const response = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bomDiffBaseOrder: baseOnlyOrder,
          bomDiffTargetOrder: targetOnlyOrder,
        }),
      });
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      if (response.status === 403) {
        setOrderSaveState("error");
        return;
      }
      if (!response.ok) {
        setOrderSaveState("error");
        return;
      }
      setProject((prev) =>
        prev
          ? {
              ...prev,
              bomDiffBaseOrder: baseOnlyOrder,
              bomDiffTargetOrder: targetOnlyOrder,
            }
          : prev
      );
      setOrderSaveState("saved");
    })().catch(() => {
      setOrderSaveState("error");
    });
  };

  const departmentName =
    project?.departmentId && departments.find((d) => d.id === project.departmentId)?.name;

  const removeDiffTraceItem = (diffIndex: number, traceIndex: number) => {
    if (!allowEdit) return;
    const nextGroups = diffTraceGroups.map((group, index) => {
      const items = Array.isArray(group) ? group : [];
      if (index !== diffIndex) return items;
      return items.filter((_, itemIndex) => itemIndex !== traceIndex);
    });
    setErrorMessage("");
    void (async () => {
      const response = await fetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bomDiffItems: diffItems,
          bomDiffTraceItems: nextGroups,
        }),
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
        setErrorMessage("保存关联BOM失败");
        return;
      }
      const updated = (await response.json()) as Project;
      setProject(updated);
    })();
  };

  /* pricing tab helpers */
  const fmtPrice = (v: number | null) => (v === null || !Number.isFinite(v)) ? "-" : v.toFixed(2);
  const fmtDelta = (v: number) => (!Number.isFinite(v) || Math.abs(v) < 0.0001) ? "-" : `${v > 0 ? "+" : ""}${v.toFixed(2)}`;
  const pStatusLbl = (s: PricingDiff["status"]) => ({ added: "新增", removed: "删除", changed: "变更", unchanged: "不变" }[s] || "不变");
  const pStatusCls = (s: PricingDiff["status"]) => ({
    added: "text-blue-600 bg-blue-50 border-blue-200",
    removed: "text-red-600 bg-red-50 border-red-200",
    changed: "text-amber-600 bg-amber-50 border-amber-200",
    unchanged: "text-[#8f959e] bg-[#f8f9fb] border-[#e8eaed]",
  }[s] || "");

  const loadPricingList = useCallback(async () => {
    if (!id) return;
    setPricingLoading(true);
    try {
      const r = await fetch(`/api/pricing?projectId=${id}`);
      if (r.ok) {
        const data = await r.json() as { items?: PricingSheetSummary[] };
        const items = Array.isArray(data.items) ? data.items : [];
        setPricingList(items);
        if (!pricingSelectedId || !items.some((s) => s.id === pricingSelectedId)) {
          setPricingSelectedId(items[0]?.id || "");
        }
      }
    } catch { /* ignore */ }
    finally { setPricingLoading(false); }
  }, [id, pricingSelectedId]);

  const loadPricingDetail = useCallback(async (sheetId: string) => {
    if (!sheetId) { setPricingDetail(null); return; }
    setPricingDetailLoading(true);
    try {
      const r = await fetch(`/api/pricing/${sheetId}`);
      if (r.ok) {
        const data = await r.json() as { sheet?: PricingSheet };
        setPricingDetail(data.sheet || null);
      } else { setPricingDetail(null); }
    } catch { setPricingDetail(null); }
    finally { setPricingDetailLoading(false); }
  }, []);
  const loadPricingLogs = useCallback(async (sheetId: string) => {
    if (!sheetId) {
      setPricingLogs([]);
      return;
    }
    setPricingLogsLoading(true);
    try {
      const r = await fetch(`/api/pricing/logs?sheetId=${sheetId}`);
      if (r.ok) {
        const data = await r.json() as { logs?: PricingLog[] };
        setPricingLogs(Array.isArray(data.logs) ? data.logs : []);
      } else {
        setPricingLogs([]);
      }
    } catch {
      setPricingLogs([]);
    } finally {
      setPricingLogsLoading(false);
    }
  }, []);

  useEffect(() => {
    setPricingShowAllMainColumns(false);
    setPricingShowAllDiffColumns(false);
    if (pricingSelectedId) void loadPricingDetail(pricingSelectedId);
  }, [pricingSelectedId, loadPricingDetail]);

  useEffect(() => {
    if (!id || activeTab !== "pricing") return;
    if (pricingList.length === 0 && !pricingLoading) {
      void loadPricingList();
    }
  }, [activeTab, id, pricingList.length, pricingLoading, loadPricingList]);

  const handlePricingUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pricingFile || !id) return;
    setPricingUploading(true); setPricingMsg("");
    const fd = new FormData();
    fd.append("file", pricingFile);
    fd.append("projectId", id);
    try {
      const r = await fetch("/api/pricing", { method: "POST", body: fd });
      const data = await r.json() as { message?: string; status?: string; sheetKey?: string; sheet?: PricingSheet; parseInfo?: { itemCount?: number } };
      if (!r.ok) { setPricingMsg(data.message || "上传失败"); return; }
      setPricingMsg(data.status === "duplicate"
        ? `文件未变化（${data.sheetKey}）`
        : `上传成功（${data.sheetKey}），${data.parseInfo?.itemCount ?? "?"}条明细`);
      setPricingFile(null);
      if (pricingFileRef.current) pricingFileRef.current.value = "";
      await loadPricingList();
      if (data.sheet?.id) { setPricingSelectedId(data.sheet.id); setPricingDetail(data.sheet); }
    } catch { setPricingMsg("网络异常"); }
    finally { setPricingUploading(false); }
  };

  const pDiffs = useMemo(() => pricingDetail?.diffs || [], [pricingDetail]);
  const pDiffStats = useMemo(() => ({
    total: pDiffs.length,
    changed: pDiffs.filter((d) => d.status === "changed").length,
    added: pDiffs.filter((d) => d.status === "added").length,
    removed: pDiffs.filter((d) => d.status === "removed").length,
  }), [pDiffs]);
  const pBaseVer = pricingDetail?.versions.find((v) => v.id === pricingDetail.baseVersionId);
  const pLatestVer = pricingDetail?.versions.find((v) => v.id === pricingDetail.latestVersionId);
  const pIsMultiVer = (pricingDetail?.versions.length ?? 0) > 1;
  const pDiffCols = useMemo<PricingColumn[]>(() => pricingDetail?.diffColumns || [], [pricingDetail]);
  const pVisibleMainCols = useMemo(
    () =>
      pricingShowAllMainColumns
        ? (pricingDetail?.mainColumns || [])
        : (pricingDetail?.mainColumns || []).slice(0, 12),
    [pricingDetail, pricingShowAllMainColumns]
  );
  const pVisibleDiffCols = useMemo(
    () => (pricingShowAllDiffColumns ? pDiffCols : pDiffCols.slice(0, 12)),
    [pDiffCols, pricingShowAllDiffColumns]
  );
  const pDisplayDiffs = useMemo(() => pDiffs.slice(0, 200), [pDiffs]);
  const pLevelColumnKey = useMemo(() => {
    const col = pDiffCols.find((c) => {
      const label = String(c.label || "").toLowerCase();
      return label.includes("层次") || label.includes("level");
    });
    return col?.key || "";
  }, [pDiffCols]);
  const pSummary = useMemo(() => {
    let baseSum = 0;
    let latestSum = 0;
    let deltaSum = 0;
    let countedRows = 0;
    for (const diff of pDiffs) {
      if (pLevelColumnKey) {
        const level = String(diff.fields?.[pLevelColumnKey] || "").trim();
        if (level !== ".1") continue;
      }
      const base = typeof diff.baseAmount === "number" ? diff.baseAmount : (typeof diff.basePrice === "number" ? diff.basePrice : 0);
      const latest = typeof diff.latestAmount === "number" ? diff.latestAmount : (typeof diff.latestPrice === "number" ? diff.latestPrice : 0);
      const delta = typeof diff.deltaAmount === "number" ? diff.deltaAmount : (typeof diff.delta === "number" ? diff.delta : latest - base);
      baseSum += Number.isFinite(base) ? base : 0;
      latestSum += Number.isFinite(latest) ? latest : 0;
      deltaSum += Number.isFinite(delta) ? delta : 0;
      countedRows += 1;
    }
    return { baseSum, latestSum, deltaSum, countedRows };
  }, [pDiffs, pLevelColumnKey]);
  const overviewPricingDiffRows = useMemo<Array<PricingDiff & { deltaValue: number }>>(
    () =>
      pDiffs
        .filter((d) => d.status === "added" || d.status === "removed" || d.status === "changed")
        .map((d) => ({
          ...d,
          deltaValue:
            typeof d.deltaAmount === "number"
              ? d.deltaAmount
              : (typeof d.delta === "number"
                  ? d.delta
                  : ((d.latestAmount ?? d.latestPrice ?? 0) - (d.baseAmount ?? d.basePrice ?? 0))),
        })),
    [pDiffs]
  );
  const overviewChangedRows = useMemo(
    () => overviewPricingDiffRows.filter((row) => row.status === "changed"),
    [overviewPricingDiffRows]
  );
  const overviewAddedRows = useMemo(
    () => overviewPricingDiffRows.filter((row) => row.status === "added"),
    [overviewPricingDiffRows]
  );
  const overviewRemovedRows = useMemo(
    () => overviewPricingDiffRows.filter((row) => row.status === "removed"),
    [overviewPricingDiffRows]
  );
  const handleActiveTabChange = useCallback((nextTab: string) => {
    setActiveTab(nextTab);
    setVisitedTabs((prev) => {
      if (prev.has(nextTab)) return prev;
      const next = new Set(prev);
      next.add(nextTab);
      return next;
    });
    if (nextTab === "pricing" && pricingList.length === 0) {
      void loadPricingList();
    }
  }, [loadPricingList, pricingList.length]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#f5f6f8] flex items-center justify-center text-[#8f959e]">
        <div className="flex flex-col items-center gap-2">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#3370ff]"></div>
          <p>正在加载项目...</p>
        </div>
      </div>
    );
  }

  if (!project || !currentUser) {
    return (
      <div className="min-h-screen bg-[#f5f6f8] flex items-center justify-center text-[#8f959e]">
        {errorMessage || "正在跳转登录..."}
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-12 bg-[#f5f6f8]">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white/85 backdrop-blur-md border-b border-[#e8eaed]" style={{ height: 52 }}>
        <div className="mx-auto max-w-screen-2xl px-5 h-full flex items-center">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => router.back()}
              className="h-8 w-8 rounded-lg flex items-center justify-center text-[#8f959e] hover:text-[#1f2329] hover:bg-[#f0f1f3] transition-colors">
              <ArrowLeft className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => router.push("/")}
              className="h-8 w-8 rounded-lg flex items-center justify-center text-[#8f959e] hover:text-[#1f2329] hover:bg-[#f0f1f3] transition-colors">
              <Home className="h-4 w-4" />
            </button>
            <div className="h-4 w-px bg-[#e8eaed] mx-1" />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-[15px] font-semibold text-[#1f2329] truncate">{project.name}</h1>
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${project.type === 'company' ? 'bg-purple-50 text-purple-600' : 'bg-blue-50 text-blue-600'}`}>
                  {project.type === "company" ? "公司级" : "部门级"}
                </span>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-[#8f959e] -mt-0.5">
                 <span className="flex items-center gap-1"><Users className="h-3 w-3" />{project.initiator}</span>
                 <span>·</span>
                 <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{project.cycle}</span>
              </div>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-3">
             <div className="hidden sm:flex items-center gap-2 text-xs">
                <span className="text-[#8f959e]">进度</span>
                <div className="w-20 h-1.5 bg-[#f0f1f3] rounded-full overflow-hidden">
                  <div className="h-full bg-[#3370ff] rounded-full transition-all" style={{ width: `${project.progress}%` }} />
                </div>
                <span className="font-semibold text-[#3370ff]">{project.progress}%</span>
             </div>
            <div className="text-xs text-[#8f959e] bg-[#f8f9fb] px-2.5 py-1 rounded-lg border border-[#e8eaed]">
              {currentUser.name}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-screen-2xl px-5 py-6">
        {errorMessage && (
          <div className="mb-5 flex items-center gap-2 rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-600">
            {errorMessage}
          </div>
        )}
        {!isAllowed ? (
          <div className="bg-white rounded-xl border border-[#e8eaed] p-12 text-center max-w-lg mx-auto mt-10">
            <div className="h-16 w-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4 text-red-500">
               <Trash2 className="h-8 w-8" />
            </div>
            <div className="text-lg font-semibold text-[#1f2329] mb-2">当前账号无权限查看该项目</div>
            <div className="text-sm text-[#8f959e]">请切换账号或联系管理员授权</div>
            <Button variant="outline" className="mt-6" onClick={() => router.back()}>返回上一页</Button>
          </div>
        ) : (
          <div className="max-w-screen-2xl mx-auto">
             <Tabs value={activeTab} onValueChange={handleActiveTabChange} className="space-y-6">
                <div className="flex items-center justify-between">
                   <TabsList className="h-11 rounded-2xl border border-[#d8dee8] bg-gradient-to-r from-[#ffffff] via-[#f8fbff] to-[#eef5ff] p-1 shadow-[0_8px_20px_rgba(15,57,120,0.08)] gap-1">
                      <TabsTrigger value="overview" className="h-9 px-4 gap-1.5 rounded-xl text-xs font-semibold tracking-[0.01em] data-[state=active]:bg-[#0f5fd6] data-[state=active]:text-white data-[state=active]:shadow-[0_6px_16px_rgba(15,95,214,0.35)]">
                         <LayoutDashboard className="h-3.5 w-3.5" />
                         项目总览
                      </TabsTrigger>
                      <TabsTrigger value="cost" className="h-9 px-4 gap-1.5 rounded-xl text-xs font-semibold tracking-[0.01em] data-[state=active]:bg-[#0f5fd6] data-[state=active]:text-white data-[state=active]:shadow-[0_6px_16px_rgba(15,95,214,0.35)]">
                         <TrendingDown className="h-3.5 w-3.5" />
                         降本分析
                      </TabsTrigger>
                      <TabsTrigger value="measures" className="h-9 px-4 gap-1.5 rounded-xl text-xs font-semibold tracking-[0.01em] data-[state=active]:bg-[#0f5fd6] data-[state=active]:text-white data-[state=active]:shadow-[0_6px_16px_rgba(15,95,214,0.35)]">
                         <ListTodo className="h-3.5 w-3.5" />
                         实施措施
                      </TabsTrigger>
                      <TabsTrigger value="pricing" className="h-9 px-4 gap-1.5 rounded-xl text-xs font-semibold tracking-[0.01em] data-[state=active]:bg-[#0f5fd6] data-[state=active]:text-white data-[state=active]:shadow-[0_6px_16px_rgba(15,95,214,0.35)]">
                         <FileSpreadsheet className="h-3.5 w-3.5" />
                         BOM核价
                         {pricingList.length > 0 && <span className="ml-1 text-[10px] bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded-full">{pricingList.length}</span>}
                      </TabsTrigger>
                   </TabsList>
                </div>

                {/* Tab: Project Overview */}
                <TabsContent value="overview" className="space-y-5">
                   <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                      {/* Left Column: Basic Info */}
                      <div className="lg:col-span-8 space-y-5">
                         <div className="bg-white rounded-xl border border-[#e8eaed] overflow-hidden">
                            <div className="px-5 py-3.5 border-b border-[#e8eaed] bg-[#f8f9fb]">
                               <h3 className="text-sm font-semibold text-[#1f2329] flex items-center gap-2">
                                  <FileText className="h-4 w-4 text-blue-500" />
                                  基本信息
                               </h3>
                            </div>
                            <div className="p-5 space-y-5">
                               <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                  <div>
                                     <div className="text-xs font-medium text-[#8f959e] mb-1">项目名称</div>
                                     <div className="text-sm text-[#1f2329] font-medium">{project.name}</div>
                                  </div>
                                  <div>
                                     <div className="text-xs font-medium text-[#8f959e] mb-1">所属部门</div>
                                     <div className="text-sm text-[#1f2329]">{departmentName || "全公司"}</div>
                                  </div>
                                  <div>
                                     <div className="text-xs font-medium text-[#8f959e] mb-1">发起人/小组</div>
                                     <div className="text-sm text-[#1f2329]">{project.initiator}</div>
                                  </div>
                                  <div>
                                     <div className="text-xs font-medium text-[#8f959e] mb-1">项目周期</div>
                                     <div className="text-sm text-[#1f2329]">{project.cycle}</div>
                                  </div>
                               </div>
                               
                               <div className="pt-5 border-t border-[#f0f1f3]">
                                  <div className="text-xs font-medium text-[#8f959e] mb-2">问题描述 / 机会点</div>
                                  <div className="text-sm text-[#1f2329] bg-[#f8f9fb] p-4 rounded-lg leading-relaxed">
                                     {project.problem || "暂无描述"}
                                  </div>
                               </div>

                               <div>
                                  <div className="text-xs font-medium text-[#8f959e] mb-2">项目目标 (SMART)</div>
                                  <div className="text-sm text-[#1f2329] bg-[#f0f4ff] p-4 rounded-lg leading-relaxed border-l-3 border-[#3370ff]">
                                     {project.goal || "暂无目标"}
                                  </div>
                               </div>

                               <div className="pt-5 border-t border-[#eef2f7] space-y-4">
                                  <div className="flex items-center justify-between">
                                     <h3 className="text-sm font-semibold text-[#102a43] flex items-center gap-2">
                                        <FileSpreadsheet className="h-4 w-4 text-[#0f5fd6]" />
                                        BOM差异总览
                                     </h3>
                                     <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-8 rounded-lg border-[#c9d8ef] text-[#0f5fd6] hover:bg-[#eaf2ff]"
                                        onClick={() => handleActiveTabChange("pricing")}
                                     >
                                        查看核价
                                     </Button>
                                  </div>
                                  {!pricingDetail ? (
                                    <div className="rounded-xl border border-dashed border-[#c9d8ef] bg-[#f7fbff] px-4 py-6 text-sm text-[#6b7785]">
                                      暂无 BOM 核价差异数据
                                    </div>
                                  ) : overviewPricingDiffRows.length === 0 ? (
                                    <div className="rounded-xl border border-dashed border-[#c9d8ef] bg-[#f7fbff] px-4 py-6 text-sm text-[#6b7785]">
                                      当前版本未检测到新增/变更/删除物料
                                    </div>
                                  ) : (
                                    <div className="space-y-3">
                                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                        <div className="rounded-lg border border-[#ffe4b3] bg-[#fffbf3] px-3 py-2.5">
                                          <div className="text-[11px] text-[#a86f00]">变更</div>
                                          <div className="text-base font-semibold text-[#7a4a00]">{pDiffStats.changed} 条</div>
                                        </div>
                                        <div className="rounded-lg border border-[#cfe3ff] bg-[#f4f8ff] px-3 py-2.5">
                                          <div className="text-[11px] text-[#2f67b5]">新增</div>
                                          <div className="text-base font-semibold text-[#144b9a]">{pDiffStats.added} 条</div>
                                        </div>
                                        <div className="rounded-lg border border-[#ffd6d6] bg-[#fff7f7] px-3 py-2.5">
                                          <div className="text-[11px] text-[#c2410c]">删除</div>
                                          <div className="text-base font-semibold text-[#b42318]">{pDiffStats.removed} 条</div>
                                        </div>
                                      </div>

                                      {[
                                        {
                                          key: "changed",
                                          title: "变更",
                                          rows: overviewChangedRows,
                                          wrapCls: "border-[#ffe4b3] bg-[#fffbf3]",
                                          headCls: "border-[#ffe4b3] text-[#7a4a00]",
                                          bodyCls: "divide-[#ffe9c6]",
                                          hoverCls: "hover:bg-[#fff9ea]",
                                        },
                                        {
                                          key: "added",
                                          title: "新增",
                                          rows: overviewAddedRows,
                                          wrapCls: "border-[#cfe3ff] bg-[#f4f8ff]",
                                          headCls: "border-[#cfe3ff] text-[#144b9a]",
                                          bodyCls: "divide-[#dce9ff]",
                                          hoverCls: "hover:bg-[#eef5ff]",
                                        },
                                        {
                                          key: "removed",
                                          title: "删除",
                                          rows: overviewRemovedRows,
                                          wrapCls: "border-[#ffd6d6] bg-[#fff7f7]",
                                          headCls: "border-[#ffd6d6] text-[#b42318]",
                                          bodyCls: "divide-[#ffdede]",
                                          hoverCls: "hover:bg-[#fff1f1]",
                                        },
                                      ].map((section) => (
                                        <div key={section.key} className={cn("rounded-xl border overflow-hidden", section.wrapCls)}>
                                          <div className={cn("px-4 py-2.5 border-b flex items-center justify-between", section.headCls)}>
                                            <div className="text-sm font-semibold">{section.title} {section.rows.length} 条</div>
                                            <span className="text-[11px] opacity-80">明细列表</span>
                                          </div>
                                          <div className="max-h-[240px] overflow-auto">
                                            <table className="w-full text-xs">
                                              <thead className="bg-white/60 text-[#6b7785]">
                                                <tr>
                                                  <th className="px-3 py-2 text-left font-medium">物料代码</th>
                                                  <th className="px-3 py-2 text-left font-medium">物料名称</th>
                                                  <th className="px-3 py-2 text-right font-medium">差异</th>
                                                </tr>
                                              </thead>
                                              <tbody className={cn("divide-y", section.bodyCls)}>
                                                {section.rows.length === 0 ? (
                                                  <tr>
                                                    <td className="px-3 py-4 text-center text-[#8f959e]" colSpan={3}>
                                                      暂无{section.title}项
                                                    </td>
                                                  </tr>
                                                ) : (
                                                  section.rows.map((diff, index) => (
                                                    <tr key={`${diff.materialCode}-${section.key}-${index}`} className={section.hoverCls}>
                                                      <td className="px-3 py-2 font-mono text-[#1f2329]">{diff.materialCode || "-"}</td>
                                                      <td className="px-3 py-2 text-[#1f2329]">{diff.materialName || "-"}</td>
                                                      <td className={cn(
                                                        "px-3 py-2 text-right font-mono",
                                                        diff.deltaValue > 0.0001
                                                          ? "text-red-600"
                                                          : diff.deltaValue < -0.0001
                                                            ? "text-emerald-600"
                                                            : "text-[#8f959e]"
                                                      )}>
                                                        {fmtDelta(diff.deltaValue)}
                                                      </td>
                                                    </tr>
                                                  ))
                                                )}
                                              </tbody>
                                            </table>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                               </div>
                            </div>
                         </div>
                      </div>

                      {/* Right Column: Key Metrics */}
                      <div className="lg:col-span-4 space-y-5">
                         {/* 核心降本指标 */}
                         <div className="bg-white rounded-xl border border-[#e8eaed] overflow-hidden">
                            <div className="bg-gradient-to-br from-emerald-500 to-teal-600 px-5 py-4 text-white">
                               <div className="flex items-center justify-between mb-1.5">
                                  <div className="text-xs font-medium opacity-90">累计节约金额</div>
                                  <span className="text-[10px] bg-white/15 px-2 py-0.5 rounded-full">核心指标</span>
                               </div>
                               <div className="text-3xl font-bold mb-1">
                                  {formatMoney(financeSummary?.savings ?? null)}
                               </div>
                               <div className="flex items-center gap-2 text-xs opacity-90">
                                  <span>节约率</span>
                                  <span className="font-bold text-base">
                                     {formatPercent(financeSummary?.savingsRate ?? null)}
                                  </span>
                                  <span className="ml-auto text-[10px] opacity-75">目标 30%</span>
                               </div>
                            </div>
                            
                            {/* 成本对比可视化 */}
                            <div className="p-5 space-y-3.5">
                               <div>
                                  <div className="flex items-center justify-between text-xs mb-1.5">
                                     <span className="text-[#8f959e]">原成本</span>
                                     <span className="font-semibold text-[#1f2329]">
                                        {formatMoney(financeSummary?.baseCost)}
                                     </span>
                                  </div>
                                  <div className="h-2.5 w-full bg-[#f0f1f3] rounded-full overflow-hidden">
                                     <div className="h-full bg-red-400 rounded-full" style={{ width: '100%' }}></div>
                                  </div>
                               </div>
                               
                               <div>
                                  <div className="flex items-center justify-between text-xs mb-2">
                                     <span className="text-[#8f959e]">现成本</span>
                                     <span className="font-semibold text-emerald-600">
                                        {formatMoney(financeSummary?.currentCost)}
                                     </span>
                                  </div>
                                  <div className="h-3 w-full bg-[#f8f9fb] rounded-full overflow-hidden">
                                     <div 
                                        className="h-full bg-emerald-500 transition-all duration-500" 
                                        style={{ 
                                          width: `${financeSummary?.baseCost && financeSummary?.currentCost ? Math.min(100, (financeSummary.currentCost / financeSummary.baseCost) * 100) : 0}%` 
                                        }}
                                     ></div>
                                  </div>
                               </div>
                               
                               <div className="pt-3 border-t border-[#e8eaed] grid grid-cols-2 gap-3 text-xs">
                                  <div>
                                     <div className="text-[#8f959e] mb-1">销售数量</div>
                                     <div className="font-semibold text-[#1f2329]">
                                        {formatQtyValue(financeSummary?.totalQty ?? 0)}
                                     </div>
                                  </div>
                                  <div>
                                     <div className="text-[#8f959e] mb-1">现成本单价</div>
                                     <div className="font-semibold text-[#1f2329]">
                                        {formatMoney(financeSummary?.unitCost ?? null)}
                                     </div>
                                  </div>
                               </div>
                            </div>
                         </div>


                         {/* 效益结论卡片 */}
                         <div className="bg-white rounded-xl border border-[#e8eaed] overflow-hidden">
                            <div className="px-5 py-3.5 bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-[#e8eaed]">
                               <div className="text-xs font-semibold text-blue-700 mb-1">效益结论</div>
                               <div className="text-[#1f2329] text-base font-semibold">
                                  {financeSummary?.benefitText || project.benefit || "未计算"}
                               </div>
                            </div>
                            <div className="p-6 space-y-3">
                               <div>
                                  <div className="text-xs text-[#8f959e] mb-1.5">销售订单号</div>
                                  <div className="text-sm text-[#1f2329] bg-[#f8f9fb] px-3 py-2 rounded-lg break-words font-mono">
                                     {project.salesOrderNo || "-"}
                                  </div>
                               </div>
                               <div className="grid grid-cols-2 gap-3">
                                  <div className="bg-[#f8f9fb] px-3 py-2 rounded-lg">
                                     <div className="text-xs text-[#8f959e] mb-1">订单数量</div>
                                     <div className="text-lg font-bold text-[#1f2329]">{orderNoTokens.length || 0}</div>
                                  </div>
                                  <div className="bg-[#f8f9fb] px-3 py-2 rounded-lg">
                                     <div className="text-xs text-[#8f959e] mb-1">数据来源</div>
                                     <div className="text-xs font-medium text-[#1f2329]">销售出库</div>
                                  </div>
                               </div>
                            </div>
                         </div>


                         <div className="bg-white rounded-xl border border-[#e8eaed] p-5">
                            <div className="text-xs font-medium text-[#8f959e] mb-2">资源需求</div>
                            <div className="text-[#1f2329] text-sm mb-4">
                               {project.resources || "未填写"}
                            </div>
                            <div className="text-xs font-medium text-[#8f959e] mb-2">审批意见</div>
                            <div className="text-[#1f2329] text-sm">
                               {project.approval || "待审批"}
                            </div>
                         </div>
                      </div>
                   </div>

                </TabsContent>

                {/* Tab: Cost Analysis */}
                <TabsContent value="cost" className="space-y-6">
                  {visitedTabs.has("cost") && <>
                   <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                      <div>
                         <div className="text-xl font-semibold text-[#1f2329]">成本明细追踪</div>
                      </div>
                      <div className="flex items-center gap-3">
                         <div className="text-xs text-[#8f959e]">数据来源：销售出库 + 基础BOM末次成本</div>
                         <Button size="sm" className="h-9 px-5 shadow-[#3370ff33]">导出报表</Button>
                      </div>
                   </div>

                   <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                      <div className="rounded-2xl bg-white p-5 shadow-[#3370ff33] ring-1 ring-[#e8eaed]">
                         <div className="text-xs text-[#8f959e]">现成本合计</div>
                         <div className="mt-2 text-2xl font-semibold text-[#1f2329]">
                            {formatMoney(financeSummary?.currentCost)}
                         </div>
                      </div>
                      <div className="rounded-2xl bg-white p-5 shadow-[#3370ff33] ring-1 ring-[#e8eaed]">
                         <div className="text-xs text-[#8f959e]">原成本合计</div>
                         <div className="mt-2 text-2xl font-semibold text-[#1f2329]">
                            {formatMoney(financeSummary?.baseCost)}
                         </div>
                      </div>
                      <div className="rounded-2xl bg-white p-5 shadow-[#3370ff33] ring-1 ring-[#e8eaed]">
                         <div className="text-xs text-[#8f959e]">节约金额</div>
                         <div
                            className={cn(
                               "mt-2 text-2xl font-semibold",
                               typeof financeSummary?.savings === "number" && financeSummary.savings < 0
                                  ? "text-red-500"
                                  : "text-green-600"
                            )}
                         >
                            {formatMoney(financeSummary?.savings ?? null)}
                         </div>
                      </div>
                      <div className="rounded-2xl bg-white p-5 shadow-[#3370ff33] ring-1 ring-[#e8eaed]">
                         <div className="text-xs text-[#8f959e]">节约率</div>
                         <div className="mt-2 text-2xl font-semibold text-[#1f2329]">
                            {formatPercent(financeSummary?.savingsRate ?? null)}
                         </div>
                      </div>
                   </div>

                   <div className="rounded-2xl bg-white p-5 shadow-[#3370ff33] ring-1 ring-[#e8eaed]">
                      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5 text-sm">
                         <div>
                            <div className="text-xs text-[#8f959e]">销售订单号</div>
                            <div className="mt-1 text-[#1f2329] break-words">{project?.salesOrderNo || "-"}</div>
                         </div>
                         <div>
                            <div className="text-xs text-[#8f959e]">订单销售数量</div>
                            <div className="mt-1 text-[#1f2329]">{formatQtyValue(financeSummary?.totalQty ?? 0)}</div>
                         </div>
                         <div>
                            <div className="text-xs text-[#8f959e]">现成本单价</div>
                            <div className="mt-1 text-[#1f2329]">{formatMoney(financeSummary?.unitCost ?? null)}</div>
                         </div>
                         <div>
                            <div className="text-xs text-[#8f959e]">购货单位</div>
                            <div className="mt-1 text-[#1f2329]">{benefitSource?.lastCostCustomerId || "-"}</div>
                         </div>
                         <div>
                            <div className="text-xs text-[#8f959e]">基础BOM编码</div>
                            <div className="mt-1 text-[#1f2329]">{benefitSource?.lastCostMaterialCodeUsed || "-"}</div>
                         </div>
                      </div>
                   </div>

                   <div className="grid gap-6 lg:grid-cols-3">
                      <div className="lg:col-span-2 rounded-2xl bg-white p-5 shadow-[#3370ff33] ring-1 ring-[#e8eaed]">
                         <div className="flex items-center justify-between">
                            <div>
                               <div className="text-sm font-semibold text-[#1f2329]">成本明细表格</div>
                               <div className="text-xs text-[#8f959e]">按出库行汇总</div>
                            </div>
                            <div className="text-xs text-[#8f959e]">共{detailRows.length} 行</div>
                         </div>
                         <div className="mt-4 overflow-x-auto">
                            <table className="w-full text-sm">
                               <thead className="bg-[#f8f9fb] text-xs text-[#8f959e]">
                                  <tr>
                                     <th className="px-4 py-3 text-left font-medium">物料编码</th>
                                     <th className="px-4 py-3 text-left font-medium">物料名称</th>
                                     <th className="px-4 py-3 text-right font-medium">原成本单价</th>
                                     <th className="px-4 py-3 text-right font-medium">现成本单价</th>
                                     <th className="px-4 py-3 text-right font-medium">数量</th>
                                     <th className="px-4 py-3 text-right font-medium">原成本合计</th>
                                     <th className="px-4 py-3 text-right font-medium">现成本合计</th>
                                     <th className="px-4 py-3 text-right font-medium">节约金额</th>
                                  </tr>
                               </thead>
                               <tbody className="divide-y divide-[#e8eaed]">
                                  {detailRows.length === 0 ? (
                                     <tr>
                                        <td className="px-4 py-6 text-center text-[#8f959e]" colSpan={8}>
                                           暂无成本明细
                                        </td>
                                     </tr>
                                  ) : (
                                     detailRows.map((row) => (
                                        <tr key={row.key} className="hover:bg-[#f8f9fb] transition-colors">
                                           <td className="px-4 py-3 text-[#1f2329]">{row.materialCode || "-"}</td>
                                           <td className="px-4 py-3 text-[#1f2329]">{row.materialName || "-"}</td>
                                           <td className="px-4 py-3 text-right">{formatMoney(row.baseUnitCost)}</td>
                                           <td className="px-4 py-3 text-right">{formatMoney(row.currentUnitCost)}</td>
                                           <td className="px-4 py-3 text-right">{formatQtyValue(row.qty)}</td>
                                           <td className="px-4 py-3 text-right">{formatMoney(row.baseTotal)}</td>
                                           <td className="px-4 py-3 text-right">{formatMoney(row.currentTotal)}</td>
                                           <td
                                              className={cn(
                                                 "px-4 py-3 text-right font-semibold",
                                                 typeof row.savings === "number" && row.savings < 0
                                                    ? "text-red-500"
                                                    : "text-green-600"
                                              )}
                                           >
                                              {formatMoney(row.savings)}
                                           </td>
                                        </tr>
                                     ))
                                  )}
                               </tbody>
                            </table>
                         </div>
                      </div>

                      <div className="rounded-2xl bg-white p-5 shadow-[#3370ff33] ring-1 ring-[#e8eaed]">
                         <div className="text-sm font-semibold text-[#1f2329]">末次成本追踪卡片</div>
                         <div className="mt-4 space-y-4 text-sm">
                            <div>
                               <div className="text-xs text-[#8f959e]">单据号</div>
                               <div className="mt-1 text-[#1f2329] font-mono">{benefitSource?.lastCostBillNo || "-"}</div>
                            </div>
                            <div>
                               <div className="text-xs text-[#8f959e]">日期</div>
                               <div className="mt-1 text-[#1f2329]">{formatDateValue(benefitSource?.lastCostBillDate)}</div>
                            </div>
                            <div>
                               <div className="text-xs text-[#8f959e]">物料编码</div>
                               <div className="mt-1 text-[#1f2329]">{benefitSource?.lastCostResolvedMaterialCode || "-"}</div>
                            </div>
                            <div>
                               <div className="text-xs text-[#8f959e]">成本单价</div>
                               <div className="mt-1 text-[#1f2329]">{formatMoney(benefitSource?.lastCostUnitCost ?? null)}</div>
                            </div>
                            <div className="text-xs text-[#8f959e]">口径：基础BOM末次成本单据</div>
                         </div>
                      </div>
                   </div>

                   <div className="space-y-6">
                   <div className="bg-white rounded-xl border border-[#e8eaed] overflow-hidden">
                      <div className="px-5 py-3.5 border-b border-[#e8eaed] bg-[#f8f9fb] flex items-center justify-between gap-4">
                         <h3 className="text-sm font-semibold text-[#1f2329] flex items-center gap-2">
                            <FileText className="h-4 w-4 text-blue-500" />
                            差异清单
                         </h3>
                         <div className="flex items-center gap-3">
                          {hasOrderChanges && orderSaveState === "idle" && (
                            <span className="text-xs text-[#8f959e]">顺序未保存</span>
                          )}
                           {orderSaveState === "saving" && (
                             <span className="text-xs text-[#8f959e]">顺序保存中...</span>
                           )}
                           {orderSaveState === "saved" && (
                             <span className="text-xs text-emerald-600">顺序已保存</span>
                           )}
                           {orderSaveState === "error" && (
                             <span className="text-xs text-red-500">顺序保存失败</span>
                           )}
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 px-3"
                            disabled={!allowEdit || !hasOrderChanges || orderSaveState === "saving"}
                            onClick={handleSaveOrder}
                          >
                            保存顺序
                          </Button>
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
                         </div>
                      </div>
                      {isDiffOpen && (
                        <div className="p-6 space-y-4">
                          {visibleDiffItems.length === 0 ? (
                            <div className="text-sm text-[#8f959e] text-center py-10 border-2 border-dashed border-[#e8eaed] rounded-xl">
                              暂无差异项                            </div>
                          ) : (
                            <>
                              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                <div className="rounded-lg border border-[#e8eaed] overflow-hidden">
                                  <div className="px-3 py-2 text-xs text-[#8f959e] bg-[#f8f9fb]">
                                    旧BOM有 / 新BOM无（{diffGroups.baseOnly.length}）                                  </div>
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
                                          {orderedBaseOnly.map(({ item, index: diffIndex }) => {
                                            const traceItems = Array.isArray(diffTraceGroups[diffIndex]) ? diffTraceGroups[diffIndex] : [];
                                            const isFolded = diffTraceFoldedMap[diffIndex] ?? true;
                                            const diffKey = getDiffOrderKey(item);
                                            return (
                                              <>
                                                <tr
                                                  key={`${item.materialCode || item.materialName || "base"}-${diffIndex}`}
                                                  className="group bg-white hover:bg-[#f8f9fb] transition-colors"
                                                  draggable={allowEdit}
                                                  onDragStart={() => allowEdit && onDragStart("base", diffKey)}
                                                  onDragOver={onDragOver}
                                                  onDrop={() => allowEdit && onDrop("base", diffKey)}
                                                  onDragEnd={onDragEnd}
                                                >
                                                  <td className="px-4 py-2">
                                                    <span className="text-sm text-[#1f2329] font-mono">
                                                      {item.materialCode || "-"}
                                                    </span>
                                                  </td>
                                                  <td className="px-4 py-2">
                                                    <span className="text-sm text-[#1f2329]">
                                                      {item.materialName || "-"}
                                                    </span>
                                                  </td>
                                                  <td className="px-4 py-2">
                                                    <span className="text-sm text-[#1f2329]">
                                                      {formatQtyValue(item.baseQty || 0)}
                                                    </span>
                                                  </td>
                                                  <td className="px-4 py-2">
                                                    <button
                                                      type="button"
                                                      title="拖拽排序"
                                                      aria-label="拖拽排序"
                                                      className="inline-flex items-center justify-center w-8 h-8 rounded-full border border-[#e8eaed] bg-[#f8f9fb] text-[#8f959e] shadow-sm cursor-grab active:cursor-grabbing opacity-70 group-hover:opacity-100 transition-all hover:border-blue-300 hover:text-blue-600"
                                                      disabled={!allowEdit}
                                                    >
                                                      <GripVertical className="h-4 w-4" />
                                                    </button>
                                                  </td>
                                                </tr>
                                                <tr className="bg-white">
                                                  <td colSpan={4} className="px-4 pb-4">
                                                    <div className="rounded-lg border border-[#e8eaed] bg-[#f8f9fb]">
                                                      <div className="flex items-center justify-between px-3 py-2 text-xs text-[#8f959e]">
                                                        <span>关联BOM</span>
                                                        <div className="flex items-center gap-2">
                                                          <span>共{traceItems.length} 条</span>
                                                          {!!diffTraceErrorMap[diffIndex] && (
                                                            <span className="text-red-500">{diffTraceErrorMap[diffIndex]}</span>
                                                          )}
                                                          {item.itemId?.trim() && (
                                                            <Button
                                                              type="button"
                                                              variant="outline"
                                                              size="sm"
                                                              className="h-7"
                                                              onClick={() => loadDiffTraceBoms(diffIndex, item.itemId!.trim())}
                                                              disabled={diffTraceLoadingMap[diffIndex]}
                                                            >
                                                              {diffTraceLoadingMap[diffIndex]
                                                                ? "加载中..."
                                                                : traceItems.length > 0
                                                                  ? "刷新"
                                                                  : "获取"}
                                                            </Button>
                                                          )}
                                                          <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="sm"
                                                            className="h-7"
                                                            onClick={() =>
                                                              setDiffTraceFoldedMap((prev) => ({
                                                                ...prev,
                                                                [diffIndex]: !isFolded,
                                                              }))
                                                            }
                                                          >
                                                            {isFolded ? (
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
                                                      {!isFolded &&
                                                        (traceItems.length > 0 ? (
                                                          <div className="overflow-x-auto border-t border-[#e8eaed]">
                                                            <table className="w-full text-xs">
                                                              <thead className="bg-white text-[#8f959e]">
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
                                                                {traceItems.map((trace, traceIndex) => (
                                                                  <tr key={`${trace.bomNumber || trace.bomCode}-${traceIndex}`}>
                                                                    <td className="px-3 py-2">
                                                                      <span className="text-[#1f2329] font-mono">
                                                                        {trace.bomNumber || "-"}
                                                                      </span>
                                                                    </td>
                                                                    <td className="px-3 py-2">
                                                                      <span className="text-[#1f2329]">{trace.bomCode || "-"}</span>
                                                                    </td>
                                                                    <td className="px-3 py-2">
                                                                      <span className="text-[#1f2329]">{trace.bomName || "-"}</span>
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
                                                                        onClick={() => removeDiffTraceItem(diffIndex, traceIndex)}
                                                                        disabled={!allowEdit}
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
                                                        ))}
                                                    </div>
                                                  </td>
                                                </tr>
                                              </>
                                            );
                                          })}
                                        </tbody>
                                      </table>
                                    </div>
                                  ) : (
                                    <div className="px-3 py-4 text-center text-xs text-[#8f959e]">暂无明细</div>
                                  )}
                                </div>
                                <div className="rounded-lg border border-[#e8eaed] overflow-hidden">
                                  <div className="px-3 py-2 text-xs text-[#8f959e] bg-[#f8f9fb]">
                                    新BOM有 / 旧BOM无（{diffGroups.targetOnly.length}）                                  </div>
                                  {orderedTargetOnly.length > 0 ? (
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
                                          {orderedTargetOnly.map(({ item, index: diffIndex }) => {
                                            const traceItems = Array.isArray(diffTraceGroups[diffIndex]) ? diffTraceGroups[diffIndex] : [];
                                            const isFolded = diffTraceFoldedMap[diffIndex] ?? true;
                                            const diffKey = getDiffOrderKey(item);
                                            return (
                                              <>
                                                <tr
                                                  key={`${item.materialCode || item.materialName || "target"}-${diffIndex}`}
                                                  className="group bg-white hover:bg-[#f8f9fb] transition-colors"
                                                  draggable={allowEdit}
                                                  onDragStart={() => allowEdit && onDragStart("target", diffKey)}
                                                  onDragOver={onDragOver}
                                                  onDrop={() => allowEdit && onDrop("target", diffKey)}
                                                  onDragEnd={onDragEnd}
                                                >
                                                  <td className="px-4 py-2">
                                                    <span className="text-sm text-[#1f2329] font-mono">
                                                      {item.materialCode || "-"}
                                                    </span>
                                                  </td>
                                                  <td className="px-4 py-2">
                                                    <span className="text-sm text-[#1f2329]">
                                                      {item.materialName || "-"}
                                                    </span>
                                                  </td>
                                                  <td className="px-4 py-2">
                                                    <span className="text-sm text-[#1f2329]">
                                                      {formatQtyValue(item.targetQty || 0)}
                                                    </span>
                                                  </td>
                                                  <td className="px-4 py-2">
                                                    <button
                                                      type="button"
                                                      title="拖拽排序"
                                                      aria-label="拖拽排序"
                                                      className="inline-flex items-center justify-center w-8 h-8 rounded-full border border-[#e8eaed] bg-[#f8f9fb] text-[#8f959e] shadow-sm cursor-grab active:cursor-grabbing opacity-70 group-hover:opacity-100 transition-all hover:border-blue-300 hover:text-blue-600"
                                                      disabled={!allowEdit}
                                                    >
                                                      <GripVertical className="h-4 w-4" />
                                                    </button>
                                                  </td>
                                                </tr>
                                                <tr className="bg-white">
                                                  <td colSpan={4} className="px-4 pb-4">
                                                    <div className="rounded-lg border border-[#e8eaed] bg-[#f8f9fb]">
                                                      <div className="flex items-center justify-between px-3 py-2 text-xs text-[#8f959e]">
                                                        <span>关联BOM</span>
                                                        <div className="flex items-center gap-2">
                                                          <span>共{traceItems.length} 条</span>
                                                          {!!diffTraceErrorMap[diffIndex] && (
                                                            <span className="text-red-500">{diffTraceErrorMap[diffIndex]}</span>
                                                          )}
                                                          {item.itemId?.trim() && (
                                                            <Button
                                                              type="button"
                                                              variant="outline"
                                                              size="sm"
                                                              className="h-7"
                                                              onClick={() => loadDiffTraceBoms(diffIndex, item.itemId!.trim())}
                                                              disabled={diffTraceLoadingMap[diffIndex]}
                                                            >
                                                              {diffTraceLoadingMap[diffIndex]
                                                                ? "加载中..."
                                                                : traceItems.length > 0
                                                                  ? "刷新"
                                                                  : "获取"}
                                                            </Button>
                                                          )}
                                                          <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="sm"
                                                            className="h-7"
                                                            onClick={() =>
                                                              setDiffTraceFoldedMap((prev) => ({
                                                                ...prev,
                                                                [diffIndex]: !isFolded,
                                                              }))
                                                            }
                                                          >
                                                            {isFolded ? (
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
                                                      {!isFolded &&
                                                        (traceItems.length > 0 ? (
                                                          <div className="overflow-x-auto border-t border-[#e8eaed]">
                                                            <table className="w-full text-xs">
                                                              <thead className="bg-white text-[#8f959e]">
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
                                                                {traceItems.map((trace, traceIndex) => (
                                                                  <tr key={`${trace.bomNumber || trace.bomCode}-${traceIndex}`}>
                                                                    <td className="px-3 py-2">
                                                                      <span className="text-[#1f2329] font-mono">
                                                                        {trace.bomNumber || "-"}
                                                                      </span>
                                                                    </td>
                                                                    <td className="px-3 py-2">
                                                                      <span className="text-[#1f2329]">{trace.bomCode || "-"}</span>
                                                                    </td>
                                                                    <td className="px-3 py-2">
                                                                      <span className="text-[#1f2329]">{trace.bomName || "-"}</span>
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
                                                                        onClick={() => removeDiffTraceItem(diffIndex, traceIndex)}
                                                                        disabled={!allowEdit}
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
                                                        ))}
                                                    </div>
                                                  </td>
                                                </tr>
                                              </>
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

                              <div className="rounded-lg border border-[#e8eaed] overflow-hidden">
                                <div className="px-3 py-2 text-xs text-[#8f959e] bg-[#f8f9fb]">
                                  用量变化（{diffGroups.changed.length}）
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
                                          <th className="px-4 py-2 text-left font-medium">差异</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-[#e8eaed]">
                                        {diffGroups.changed.map(({ item, index: diffIndex }) => {
                                          const traceItems = Array.isArray(diffTraceGroups[diffIndex]) ? diffTraceGroups[diffIndex] : [];
                                          const isFolded = diffTraceFoldedMap[diffIndex] ?? true;
                                          return (
                                            <>
                                              <tr className="bg-white" key={`changed-${diffIndex}`}>
                                                <td className="px-4 py-2">
                                                  <span className="text-sm text-[#1f2329]">
                                                    {item.materialCode || "-"}
                                                  </span>
                                                </td>
                                                <td className="px-4 py-2">
                                                  <span className="text-sm text-[#1f2329]">
                                                    {item.materialName || "-"}
                                                  </span>
                                                </td>
                                                <td className="px-4 py-2">
                                                  <span className="text-sm text-[#1f2329]">
                                                    {formatQtyValue(item.baseQty || 0)}
                                                  </span>
                                                </td>
                                                <td className="px-4 py-2">
                                                  <span className="text-sm text-[#1f2329]">
                                                    {formatQtyValue(item.targetQty || 0)}
                                                  </span>
                                                </td>
                                                <td className="px-4 py-2">
                                                  <span className="text-sm font-medium text-[#1f2329]">
                                                    {formatQtyValue(item.delta || 0)}
                                                  </span>
                                                </td>
                                              </tr>
                                              <tr className="bg-white">
                                                <td colSpan={5} className="px-4 pb-4">
                                                  <div className="rounded-lg border border-[#e8eaed] bg-[#f8f9fb]">
                                                    <div className="flex items-center justify-between px-3 py-2 text-xs text-[#8f959e]">
                                                      <span>关联BOM</span>
                                                      <div className="flex items-center gap-2">
                                                        <span>共{traceItems.length} 条</span>
                                                        <Button
                                                          type="button"
                                                          variant="ghost"
                                                          size="sm"
                                                          className="h-7"
                                                          onClick={() =>
                                                            setDiffTraceFoldedMap((prev) => ({
                                                              ...prev,
                                                              [diffIndex]: !isFolded,
                                                            }))
                                                          }
                                                        >
                                                          {isFolded ? (
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
                                                    {!isFolded &&
                                                      (traceItems.length > 0 ? (
                                                        <div className="overflow-x-auto border-t border-[#e8eaed]">
                                                          <table className="w-full text-xs">
                                                            <thead className="bg-white text-[#8f959e]">
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
                                                              {traceItems.map((trace, traceIndex) => (
                                                                <tr key={`${trace.bomNumber || trace.bomCode}-${traceIndex}`}>
                                                                  <td className="px-3 py-2">
                                                                    <span className="text-[#1f2329] font-mono">
                                                                      {trace.bomNumber || "-"}
                                                                    </span>
                                                                  </td>
                                                                  <td className="px-3 py-2">
                                                                    <span className="text-[#1f2329]">{trace.bomCode || "-"}</span>
                                                                  </td>
                                                                  <td className="px-3 py-2">
                                                                    <span className="text-[#1f2329]">{trace.bomName || "-"}</span>
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
                                                                      onClick={() => removeDiffTraceItem(diffIndex, traceIndex)}
                                                                      disabled={!allowEdit}
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
                                                      ))}
                                                  </div>
                                                </td>
                                              </tr>
                                            </>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                ) : (
                                  <div className="px-3 py-4 text-center text-xs text-[#8f959e]">暂无变更项</div>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      )}
                   </div>
                   </div>
                  </>}
                </TabsContent>

                {/* Tab: Implementation Measures */}
                <TabsContent value="measures" className="space-y-5">
                  {visitedTabs.has("measures") && <>
                   <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                      <div className="lg:col-span-8 space-y-6">
                         {/* Action Plan */}
                         <div className="bg-white rounded-xl border border-[#e8eaed]">
                            <div className="px-5 py-3.5 border-b border-[#e8eaed] bg-[#f8f9fb]">
                               <h3 className="text-sm font-semibold text-[#1f2329] flex items-center gap-2">
                                  <Target className="h-4 w-4 text-indigo-500" />
                                  主要行动措施
                               </h3>
                            </div>
                            <div className="p-6">
                               <div className="text-[#1f2329] text-sm whitespace-pre-wrap leading-relaxed">
                                  {project.actions || "暂无行动措施"}
                               </div>
                            </div>
                         </div>
                         <div className="bg-white rounded-xl border border-[#e8eaed] overflow-hidden">
                            <div className="px-5 py-3.5 border-b border-[#e8eaed] bg-[#f8f9fb] flex items-center justify-between">
                               <h3 className="text-sm font-semibold text-[#1f2329] flex items-center gap-2">
                                <ListTodo className="h-4 w-4 text-amber-500" />
                                实施措施清单
                              </h3>
                              <span className="bg-[#f8f9fb] text-[#1f2329] text-xs px-2.5 py-1 rounded-full font-medium border border-[#e8eaed]">
                                  {measures.length} 条措施
                              </span>
                           </div>

                            {measuresLoading ? (
                              <div className="p-8 flex items-center justify-center">
                                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[#3370ff] mr-2"></div>
                                <span className="text-sm text-[#8f959e]">加载中...</span>
                              </div>
                            ) : measures.length === 0 ? (
                              <div className="p-8 text-center">
                                <ListTodo className="h-8 w-8 mx-auto mb-2 opacity-20 text-[#8f959e]" />
                                <div className="text-sm text-[#8f959e]">暂无实施措施</div>
                              </div>
                            ) : (
                              <div className="overflow-x-auto">
                                <table className="w-full">
                                  <thead className="bg-[#f8f9fb] text-[#8f959e] text-xs">
                                    <tr>
                                      <th className="px-4 py-3 text-left font-medium">主要行动措施</th>
                                      <th className="px-4 py-3 text-left font-medium">措施描述</th>
                                      <th className="px-4 py-3 text-left font-medium">责任人</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-[#e8eaed]">
                                    {measures.map((measure, index) => (
                                      <tr key={index} className="hover:bg-[#f8f9fb] transition-colors">
                                        <td className="px-4 py-3">
                                          <div className="text-sm font-medium text-[#1f2329]">
                                            {measure.mainAction || "-"}
                                          </div>
                                        </td>
                                        <td className="px-4 py-3">
                                          <div className="text-sm text-[#1f2329] whitespace-pre-wrap">
                                            {measure.description || "-"}
                                          </div>
                                        </td>
                                        <td className="px-4 py-3">
                                          <div className="text-sm text-[#1f2329]">
                                            {measure.responsiblePerson || "-"}
                                          </div>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                         </div>
                      </div>

                      <div className="lg:col-span-4 space-y-6">
                        <div className="bg-white rounded-xl border border-[#e8eaed] overflow-hidden">
                          <div className="px-4 py-3.5 border-b border-[#e8eaed] bg-[#f8f9fb] flex items-center justify-between">
                            <h3 className="text-sm font-semibold text-[#1f2329] flex items-center gap-2">
                              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                              任务清单
                            </h3>
                            <span className="text-[11px] text-[#8f959e]">
                              已完成 {taskSummary.done} / {taskSummary.total}
                            </span>
                          </div>
                          <div className="p-4 space-y-3">
                            <div className="grid grid-cols-3 gap-2 text-center">
                              <div className="rounded-lg border border-[#e8eaed] py-2">
                                <div className="text-[10px] text-[#8f959e]">总数</div>
                                <div className="text-sm font-semibold text-[#1f2329]">{taskSummary.total}</div>
                              </div>
                              <div className="rounded-lg border border-[#e8eaed] py-2">
                                <div className="text-[10px] text-[#8f959e]">进行中</div>
                                <div className="text-sm font-semibold text-[#d97706]">{taskSummary.pending}</div>
                              </div>
                              <div className="rounded-lg border border-[#e8eaed] py-2">
                                <div className="text-[10px] text-[#8f959e]">完成</div>
                                <div className="text-sm font-semibold text-emerald-600">{taskSummary.done}</div>
                              </div>
                            </div>

                            {allowEdit ? (
                              <div className="space-y-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="w-full h-8 text-xs"
                                  onClick={syncMeasureTasks}
                                  disabled={pendingMeasureTaskDrafts.length === 0}
                                >
                                  同步措施到任务（待同步 {pendingMeasureTaskDrafts.length} 条）
                                </Button>
                                <form onSubmit={handleAddTask} className="flex items-center gap-2">
                                  <Input
                                    value={newTaskTitle}
                                    onChange={(e) => setNewTaskTitle(e.target.value)}
                                    placeholder="新增任务..."
                                    className="h-8 text-xs"
                                  />
                                  <Button type="submit" size="sm" className="h-8 px-3 text-xs">
                                    添加
                                  </Button>
                                </form>
                              </div>
                            ) : null}

                            {displayTasks.length === 0 ? (
                              <div className="text-xs text-[#8f959e] text-center py-6">暂无任务</div>
                            ) : (
                              <div className="space-y-1.5 max-h-[280px] overflow-auto">
                                {displayTasks.map((task) => (
                                  <div
                                    key={task.id}
                                    className="flex items-center gap-2 rounded-lg border border-[#edf0f3] bg-[#fafbfc] px-2.5 py-2"
                                  >
                                    <button
                                      type="button"
                                      className="shrink-0 text-[#8f959e] hover:text-[#1f2329]"
                                      onClick={() => toggleTask(task.id)}
                                      disabled={!allowEdit}
                                      aria-label={task.completed ? "标记为未完成" : "标记为完成"}
                                    >
                                      {task.completed ? (
                                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                                      ) : (
                                        <Circle className="h-4 w-4" />
                                      )}
                                    </button>
                                    <div
                                      className={cn(
                                        "min-w-0 flex-1 text-xs",
                                        task.completed ? "line-through text-[#9aa0a8]" : "text-[#1f2329]"
                                      )}
                                    >
                                      {task.title}
                                    </div>
                                    {allowEdit ? (
                                      <button
                                        type="button"
                                        className="text-[#c9cdd4] hover:text-red-500 transition-colors"
                                        onClick={() => deleteTask(task.id)}
                                        aria-label="删除任务"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </button>
                                    ) : null}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="bg-white rounded-xl border border-[#e8eaed] p-4">
                          <h3 className="text-sm font-semibold text-[#1f2329] mb-3 flex items-center gap-2">
                            <Calendar className="h-4 w-4 text-purple-500" />
                            措施推进视图
                          </h3>
                          {measureTaskDrafts.length === 0 ? (
                            <div className="text-xs text-[#8f959e] py-4">暂无措施项可展示</div>
                          ) : (
                            <div className="relative border-l-2 border-[#e8eaed] ml-2 space-y-4 pl-4 py-1">
                              {measureTaskDrafts.map((item, index) => {
                                const linked = taskTitleSet.has(normalizeTaskTitle(item.title));
                                return (
                                  <div key={item.id} className="relative">
                                    <div
                                      className={cn(
                                        "absolute -left-[21px] h-3.5 w-3.5 rounded-full border-2 border-white",
                                        linked ? "bg-emerald-500" : "bg-[#c9cdd4]"
                                      )}
                                    />
                                    <div className="text-xs font-medium text-[#1f2329]">
                                      {index + 1}. {item.mainAction || "未命名措施"}
                                    </div>
                                    <div className="text-[11px] text-[#8f959e] mt-0.5">
                                      责任人: {item.responsiblePerson || "-"} · {linked ? "已进入任务清单" : "未同步任务"}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                   </div>
                  </>}
                </TabsContent>

                {/* Tab: BOM Pricing */}
                <TabsContent value="pricing" className="space-y-5">
                  {visitedTabs.has("pricing") && <>
                  <div className="bg-white rounded-xl border border-[#e8eaed] overflow-hidden">
                    <div className="px-5 py-3.5 border-b border-[#e8eaed] bg-[#f8f9fb] flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-[#1f2329] flex items-center gap-2">
                        <Upload className="h-4 w-4 text-indigo-500" />
                        上传BOM Excel
                      </h3>
                      <div className="flex items-center gap-1.5">
                        <Button size="sm" variant="ghost" className="gap-1 text-xs" onClick={() => router.push("/pricing")}>
                          <FileSpreadsheet className="h-3.5 w-3.5" /> 全部核价单
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="gap-1 text-xs"
                          disabled={!pricingDetail}
                          onClick={() => setPricingVersionsOpen(true)}
                        >
                          <Clock className="h-3.5 w-3.5" /> 版本记录
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="gap-1 text-xs"
                          disabled={!pricingDetail}
                          onClick={() => {
                            if (!pricingDetail) return;
                            setPricingLogsOpen(true);
                            void loadPricingLogs(pricingDetail.id);
                          }}
                        >
                          <History className="h-3.5 w-3.5" /> 查看日志
                        </Button>
                        {pricingDetail && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="gap-1 text-xs"
                            onClick={() => window.open(`/api/pricing/export/${pricingDetail.id}`, "_blank")}
                          >
                            <Download className="h-3.5 w-3.5" /> 导出对比
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="p-5">
                      <form onSubmit={handlePricingUpload} className="flex items-end gap-3">
                        <div className="flex-1">
                          <Input
                            ref={pricingFileRef}
                            type="file"
                            accept=".xlsx,.xls"
                            onChange={(e) => setPricingFile(e.target.files?.[0] || null)}
                            className="h-9 text-xs"
                          />
                        </div>
                        <Button type="submit" size="sm" disabled={pricingUploading || !pricingFile} className="h-9 px-5">
                          {pricingUploading ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> 解析中...</> : "上传并解析"}
                        </Button>
                      </form>
                      {pricingMsg && (
                        <div className={cn("mt-3 text-xs px-3 py-2 rounded-lg", pricingMsg.includes("失败") || pricingMsg.includes("异常") ? "bg-red-50 text-red-600" : "bg-emerald-50 text-emerald-600")}>
                          {pricingMsg}
                        </div>
                      )}
                      <p className="mt-2 text-xs text-[#8f959e]">上传BOM Excel自动识别物料和金额。相同编号再次上传会生成新版本，自动对比差异。</p>
                    </div>
                  </div>

                  {pricingLoading ? (
                    <div className="bg-white rounded-xl border border-[#e8eaed] p-5 space-y-3">
                      <div className="h-4 w-40 bg-[#f0f1f3] rounded animate-pulse" />
                      <div className="h-9 bg-[#f6f7f9] rounded-lg animate-pulse" />
                      <div className="h-32 bg-[#f8f9fb] rounded-lg animate-pulse" />
                    </div>
                  ) : pricingList.length === 0 ? (
                    <div className="bg-white rounded-xl border border-[#e8eaed] p-10 text-center">
                      <FileSpreadsheet className="h-10 w-10 mx-auto text-[#8f959e] mb-3 opacity-30" />
                      <div className="text-sm text-[#8f959e]">该项目暂无核价单，上传BOM Excel开始</div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                        {pricingList.map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => setPricingSelectedId(s.id)}
                            className={cn(
                              "shrink-0 px-4 py-2 rounded-lg text-sm font-medium border transition-all whitespace-nowrap",
                              s.id === pricingSelectedId
                                ? "bg-white text-[#1f2329] border-[#e8eaed] shadow-sm"
                                : "bg-transparent text-[#8f959e] border-transparent hover:bg-[#f8f9fb]"
                            )}
                          >
                            {s.name || s.key}
                            {s.versionCount > 1 && <span className="ml-1.5 text-xs opacity-60">V{s.latestVersionNo}</span>}
                          </button>
                        ))}
                      </div>

                      {pricingDetailLoading && (
                        <div className="bg-white rounded-xl border border-[#e8eaed] p-5 space-y-3">
                          <div className="h-4 w-52 bg-[#f0f1f3] rounded animate-pulse" />
                          <div className="h-10 bg-[#f6f7f9] rounded-lg animate-pulse" />
                          <div className="h-52 bg-[#f8f9fb] rounded-lg animate-pulse" />
                        </div>
                      )}

                      {pricingDetail && !pricingDetailLoading && (
                        <div className="space-y-4">
                          <div className="bg-white rounded-xl border border-[#e8eaed] px-5 py-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-xs">
                            <span className="text-[#8f959e]">编号: <strong className="text-[#1f2329] font-mono">{pricingDetail.key}</strong></span>
                            <span className="text-[#8f959e]">共 <strong className="text-[#1f2329]">{pDiffStats.total}</strong> 条明细</span>
                            {pIsMultiVer && (
                              <>
                                <span className="text-[#8f959e]">版本: <strong className="text-[#1f2329]">V{pBaseVer?.versionNo || 1} → V{pLatestVer?.versionNo}</strong></span>
                                {pDiffStats.changed > 0 && <span className="text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">变更 {pDiffStats.changed}</span>}
                                {pDiffStats.added > 0 && <span className="text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200">新增 {pDiffStats.added}</span>}
                                {pDiffStats.removed > 0 && <span className="text-red-600 bg-red-50 px-2 py-0.5 rounded-full border border-red-200">删除 {pDiffStats.removed}</span>}
                              </>
                            )}
                          </div>

                          {pVisibleMainCols.length > 0 && (
                            <div className="bg-white rounded-xl border border-[#e8eaed] overflow-hidden">
                              <div className="px-5 py-3 border-b border-[#e8eaed] bg-[#f8f9fb] flex items-center justify-between">
                                <span className="text-xs font-semibold text-[#1f2329] flex items-center gap-2">
                                  <FileText className="h-3.5 w-3.5 text-blue-500" />
                                  主表信息
                                </span>
                                {(pricingDetail.mainColumns?.length ?? 0) > pVisibleMainCols.length && (
                                  <button
                                    type="button"
                                    onClick={() => setPricingShowAllMainColumns((prev) => !prev)}
                                    className="text-[11px] font-normal text-blue-600 hover:underline"
                                  >
                                    {pricingShowAllMainColumns ? "收起" : `显示全部字段（${pricingDetail.mainColumns?.length ?? 0}）`}
                                  </button>
                                )}
                              </div>
                              <div className="overflow-x-auto">
                                <table className="w-full text-xs border-collapse">
                                  <thead className="bg-[#f8f9fb] text-[#8f959e]">
                                    <tr>
                                      {pVisibleMainCols.map((col) => (
                                        <th key={col.key} className="px-3 py-2 text-left font-medium whitespace-nowrap border-r border-b border-[#e8eaed] last:border-r-0">{col.label}</th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    <tr>
                                      {pVisibleMainCols.map((col) => (
                                        <td key={col.key} className="px-3 py-2 text-[#1f2329] whitespace-nowrap border-r border-b border-[#e8eaed] last:border-r-0 max-w-[220px] truncate">
                                          {pricingDetail.mainFields?.[col.key] || "—"}
                                        </td>
                                      ))}
                                    </tr>
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}

                          <div className="bg-white rounded-xl border border-[#e8eaed] overflow-hidden">
                            <div className="px-5 py-3 border-b border-[#e8eaed] bg-[#f8f9fb] flex items-center gap-2 text-xs font-semibold text-[#1f2329]">
                              <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-500" />
                              明细物料对比
                              {pIsMultiVer && <span className="font-normal text-[#8f959e] ml-1">V{pBaseVer?.versionNo || 1} vs V{pLatestVer?.versionNo}</span>}
                              {pDiffCols.length > pVisibleDiffCols.length && (
                                <button
                                  type="button"
                                  onClick={() => setPricingShowAllDiffColumns((prev) => !prev)}
                                  className="ml-auto text-[11px] font-normal text-blue-600 hover:underline"
                                >
                                  {pricingShowAllDiffColumns ? "收起字段" : `显示全部字段（${pDiffCols.length}）`}
                                </button>
                              )}
                            </div>
                            <div className="overflow-x-auto max-h-[50vh] overflow-y-auto">
                              <table className="w-full text-xs border-collapse">
                                <thead className="bg-[#f8f9fb] text-[#8f959e] sticky top-0 z-10">
                                  <tr>
                                    <th className="px-2 py-2 text-center font-medium w-10 border-r border-b border-[#e8eaed]">#</th>
                                    {pIsMultiVer && <th className="px-2 py-2 text-center font-medium w-14 border-r border-b border-[#e8eaed]">状态</th>}
                                    {pVisibleDiffCols.map((c) => (
                                      <th key={c.key} className="px-2 py-2 text-left font-medium whitespace-nowrap border-r border-b border-[#e8eaed]">{c.label}</th>
                                    ))}
                                    {pIsMultiVer && (
                                      <>
                                        <th className="px-2 py-2 text-right font-medium whitespace-nowrap border-r border-b border-[#e8eaed] bg-blue-50 text-blue-700">V1金额</th>
                                        <th className="px-2 py-2 text-right font-medium whitespace-nowrap border-r border-b border-[#e8eaed] bg-emerald-50 text-emerald-700">V{pLatestVer?.versionNo}金额</th>
                                        <th className="px-2 py-2 text-right font-medium whitespace-nowrap border-b border-[#e8eaed] bg-amber-50 text-amber-700">差异</th>
                                      </>
                                    )}
                                  </tr>
                                </thead>
                                <tbody>
                                  {pDiffs.length === 0 ? (
                                    <tr><td className="px-4 py-8 text-center text-[#8f959e]" colSpan={99}>暂无数据</td></tr>
                                  ) : pDisplayDiffs.map((d, i) => (
                                    <tr key={`${d.materialCode}-${i}`} className={cn("hover:bg-[#f8f9fb] transition-colors", d.status === "added" ? "bg-blue-50/40" : d.status === "removed" ? "bg-red-50/40" : d.status === "changed" ? "bg-amber-50/40" : "")}>
                                      <td className="px-2 py-1.5 text-center text-[#8f959e] border-r border-b border-[#e8eaed]">{i + 1}</td>
                                      {pIsMultiVer && (
                                        <td className="px-1 py-1.5 text-center border-r border-b border-[#e8eaed]">
                                          <span className={cn("inline-flex items-center gap-0.5 text-[10px] font-medium px-1 py-0.5 rounded border", pStatusCls(d.status))}>
                                            {d.status === "added" && <Plus className="h-2.5 w-2.5" />}
                                            {d.status === "removed" && <Minus className="h-2.5 w-2.5" />}
                                            {d.status === "changed" && <RefreshCw className="h-2.5 w-2.5" />}
                                            {pStatusLbl(d.status)}
                                          </span>
                                        </td>
                                      )}
                                      {pVisibleDiffCols.map((c) => (
                                        <td key={c.key} className="px-2 py-1.5 whitespace-nowrap border-r border-b border-[#e8eaed] text-[#1f2329] max-w-[160px] truncate">{d.fields?.[c.key] || "-"}</td>
                                      ))}
                                      {pIsMultiVer && (
                                        <>
                                          <td className="px-2 py-1.5 text-right whitespace-nowrap font-mono border-r border-b border-[#e8eaed] text-[#8f959e]">{fmtPrice(d.basePrice)}</td>
                                          <td className="px-2 py-1.5 text-right whitespace-nowrap font-mono border-r border-b border-[#e8eaed] text-[#1f2329]">{fmtPrice(d.latestPrice)}</td>
                                          <td className={cn("px-2 py-1.5 text-right whitespace-nowrap font-mono font-semibold border-b border-[#e8eaed]", d.delta > 0.0001 ? "text-red-600" : d.delta < -0.0001 ? "text-emerald-600" : "text-[#8f959e]")}>{fmtDelta(d.delta)}</td>
                                        </>
                                      )}
                                    </tr>
                                  ))}
                                  {pDiffs.length > 0 && (
                                    <tr className="bg-[#f8f9fb] font-semibold">
                                      <td className="px-2 py-2 text-right text-[#1f2329] border-r border-t-2 border-[#e8eaed]" colSpan={1 + (pIsMultiVer ? 1 : 0) + pVisibleDiffCols.length}>
                                        合计（仅层次 .1，{pSummary.countedRows} 条）
                                      </td>
                                      {pIsMultiVer && (
                                        <>
                                          <td className="px-2 py-2 text-right whitespace-nowrap font-mono border-r border-t-2 border-[#e8eaed] text-[#1f2329]">{fmtPrice(pSummary.baseSum)}</td>
                                          <td className="px-2 py-2 text-right whitespace-nowrap font-mono border-r border-t-2 border-[#e8eaed] text-[#1f2329]">{fmtPrice(pSummary.latestSum)}</td>
                                          <td className={cn("px-2 py-2 text-right whitespace-nowrap font-mono border-t-2 border-[#e8eaed]", pSummary.deltaSum > 0.0001 ? "text-red-600" : pSummary.deltaSum < -0.0001 ? "text-emerald-600" : "text-[#1f2329]")}>{fmtDelta(pSummary.deltaSum)}</td>
                                        </>
                                      )}
                                    </tr>
                                  )}
                                </tbody>
                              </table>
                            </div>
                            {pDiffs.length > 200 && (
                              <div className="px-4 py-2 text-xs text-[#8f959e] border-t border-[#e8eaed] bg-[#f8f9fb]">
                                已显示前 200 条，共 {pDiffs.length} 条。完整数据请到 <button type="button" onClick={() => router.push("/pricing")} className="text-blue-600 hover:underline">BOM核价管理页</button> 查看。
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  </>}
                </TabsContent>

             </Tabs>

             {pricingLogsOpen && (
               <div className="fixed inset-0 z-50 bg-black/35 flex items-center justify-center p-4">
                 <div className="bg-white rounded-xl border border-[#e8eaed] shadow-xl w-full max-w-3xl max-h-[75vh] overflow-hidden">
                   <div className="px-4 py-3 border-b border-[#e8eaed] bg-[#f8f9fb] flex items-center justify-between">
                     <div className="text-sm font-semibold text-[#1f2329] flex items-center gap-2">
                       <History className="h-4 w-4 text-indigo-500" />
                       操作日志
                     </div>
                     <button
                       type="button"
                       className="h-7 w-7 rounded-md flex items-center justify-center text-[#8f959e] hover:bg-[#f0f1f3] hover:text-[#1f2329]"
                       onClick={() => setPricingLogsOpen(false)}
                     >
                       <X className="h-4 w-4" />
                     </button>
                   </div>
                   <div className="p-4 overflow-auto max-h-[calc(75vh-52px)]">
                     {pricingLogsLoading ? (
                       <div className="space-y-2">
                         <div className="h-8 bg-[#f6f7f9] rounded animate-pulse" />
                         <div className="h-8 bg-[#f6f7f9] rounded animate-pulse" />
                         <div className="h-8 bg-[#f6f7f9] rounded animate-pulse" />
                       </div>
                     ) : pricingLogs.length === 0 ? (
                       <div className="text-xs text-[#8f959e] text-center py-8">暂无日志记录</div>
                     ) : (
                       <div className="space-y-2">
                         {pricingLogs.map((log) => (
                           <div key={log.id} className="px-3 py-2 rounded-lg border border-[#e8eaed] bg-[#fafbfc] text-xs text-[#1f2329]">
                             <div className="flex items-center gap-2 text-[#8f959e]">
                               <span>{new Date(log.createdAt).toLocaleString("zh-CN")}</span>
                               <span>·</span>
                               <span>{log.userName}</span>
                               <span>·</span>
                               <span>{log.action}</span>
                             </div>
                             <div className="mt-1 break-all">{log.detail || "-"}</div>
                           </div>
                         ))}
                       </div>
                     )}
                   </div>
                 </div>
               </div>
             )}
          </div>
        )}

        {pricingVersionsOpen && pricingDetail && (
          <div className="fixed inset-0 z-50 bg-black/35 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl border border-[#e8eaed] shadow-xl w-full max-w-2xl max-h-[75vh] overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#e8eaed] bg-[#f8f9fb] flex items-center justify-between">
                <div className="text-sm font-semibold text-[#1f2329] flex items-center gap-2">
                  <Clock className="h-4 w-4 text-blue-500" />
                  版本记录 — {pricingDetail.key}
                </div>
                <button type="button"
                  className="h-7 w-7 rounded-md flex items-center justify-center text-[#8f959e] hover:bg-[#f0f1f3] hover:text-[#1f2329]"
                  onClick={() => setPricingVersionsOpen(false)}>
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="p-5 overflow-auto max-h-[calc(75vh-54px)]">
                <div className="relative pl-6 space-y-3">
                  <div className="absolute left-2 top-1 bottom-1 w-px bg-[#e8eaed]" />
                  {pricingDetail.versions.map((v) => {
                    const isBase = v.id === pricingDetail.baseVersionId;
                    const isLatest = v.id === pricingDetail.latestVersionId;
                    return (
                      <div key={v.id} className="relative flex items-start gap-3 text-xs">
                        <div className={cn("absolute -left-4 mt-0.5 w-2.5 h-2.5 rounded-full border-2", isLatest ? "bg-emerald-500 border-emerald-300" : isBase ? "bg-blue-500 border-blue-300" : "bg-white border-[#e8eaed]")} />
                        <span className={cn("shrink-0 font-bold px-1.5 py-0.5 rounded", isLatest ? "bg-emerald-100 text-emerald-700" : isBase ? "bg-blue-100 text-blue-700" : "bg-[#f0f1f3] text-[#646a73]")}>
                          V{v.versionNo}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {isBase && <span className="text-blue-500 font-medium">首版</span>}
                            {isLatest && !isBase && <span className="text-emerald-500 font-medium">最新</span>}
                            <span className="text-[#1f2329] font-medium truncate">{v.fileName}</span>
                          </div>
                          <div className="text-[#8f959e] mt-0.5">
                            {new Date(v.uploadedAt).toLocaleString("zh-CN")}
                            {(v.uploadedByName || v.uploadedBy) && <> · <strong className="text-[#1f2329]">{v.uploadedByName || v.uploadedBy}</strong></>}
                            · {v.items.length} 条明细
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}







