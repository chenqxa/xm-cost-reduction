"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import AppLayout from "@/components/AppLayout";
import { PricingColumn, PricingDiff, PricingLog, PricingSheet, PricingSheetSummary, User } from "@/types";
import { cn } from "@/lib/utils";
import {
  Upload, FileSpreadsheet, GitCompare, Clock,
  Plus, RefreshCw, Columns, Filter, X, Eye, EyeOff,
  Download, ClipboardCopy, History, Search, Loader2,
} from "lucide-react";

type ParseInfo = {
  detailHeaderRow: number;
  amountColumn?: { index: number; label: string };
  priceColumn?: { index: number; label: string };
  codeColumn: { index: number; label: string };
  itemCount: number;
  totalDetailRows?: number;
  droppedMissingCode?: number;
  amountFallbackToZero?: number;
  sampleItems: { code: string; name: string; amount?: number; price?: number }[];
};

type UploadErrorDetails = {
  totalRows?: number;
  contentRows?: number;
  sampleRows?: unknown[];
};

type UploadPricingResponse = {
  message?: string;
  status?: string;
  sheetKey?: string;
  sheet?: PricingSheet;
  parseInfo?: ParseInfo;
  details?: UploadErrorDetails;
};

const MIN_COL_W = 40;
const DEF_COL_W = 120;

const fmtNum = (v: number) => Number.isFinite(v) ? v.toFixed(4) : "-";
const readBaseAmount = (d: PricingDiff) => d.baseAmount ?? d.basePrice;
const readLatestAmount = (d: PricingDiff) => d.latestAmount ?? d.latestPrice;
const readDeltaAmount = (d: PricingDiff) => {
  if (typeof d.deltaAmount === "number" && Number.isFinite(d.deltaAmount)) return d.deltaAmount;
  return d.delta;
};
const rowBg = (s: PricingDiff["status"]) => ({
  added: "bg-blue-50/40",
  removed: "bg-red-50/40",
  changed: "bg-amber-50/40",
  unchanged: "",
}[s] || "");
const tryNumber = (v: string) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

export default function PricingPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [sheetList, setSheetList] = useState<PricingSheetSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [selectedSheet, setSelectedSheet] = useState<PricingSheet | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const [sheetKey, setSheetKey] = useState("");
  const [sheetName, setSheetName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [lastParseInfo, setLastParseInfo] = useState<ParseInfo | null>(null);
  const [sheetKeyword, setSheetKeyword] = useState("");
  const [showUpload, setShowUpload] = useState(false);

  const [colFilters, setColFilters] = useState<Record<string, string>>({});
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set());
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const [showColMenu, setShowColMenu] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [showVersionModal, setShowVersionModal] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState<PricingLog[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);

  const visibleSheets = useMemo(() => {
    const keyword = sheetKeyword.trim().toLowerCase();
    if (!keyword) return sheetList;
    return sheetList.filter((s) => `${s.name || ""} ${s.key || ""}`.toLowerCase().includes(keyword));
  }, [sheetKeyword, sheetList]);

  const diffColumns = useMemo<PricingColumn[]>(() => selectedSheet?.diffColumns || [], [selectedSheet]);
  const mainColumns = useMemo<PricingColumn[]>(() => selectedSheet?.mainColumns || [], [selectedSheet]);
  const visibleMainCols = useMemo(() => mainColumns.slice(0, 12), [mainColumns]);
  const visibleDiffCols = useMemo(() => diffColumns.filter((c) => !hiddenCols.has(c.key)), [diffColumns, hiddenCols]);
  const levelColumnKey = useMemo(() => {
    const col = diffColumns.find((c) => {
      const label = String(c.label || "").toLowerCase();
      return label.includes("层次") || label.includes("level");
    });
    return col?.key || "";
  }, [diffColumns]);

  const normalizedDiffs = useMemo(() => {
    return (selectedSheet?.diffs || []).map((d) => {
      if (d.status) return d;
      let status: PricingDiff["status"] = "unchanged";
      const baseAmount = readBaseAmount(d);
      const latestAmount = readLatestAmount(d);
      const deltaAmount = readDeltaAmount(d);
      if (baseAmount === null) status = "added";
      else if (latestAmount === null) status = "removed";
      else if (Math.abs(deltaAmount) > 0.0001) status = "changed";
      return { ...d, status };
    });
  }, [selectedSheet]);

  const filteredDiffs = useMemo(() => {
    let result = normalizedDiffs;
    const activeFilters = Object.entries(colFilters).filter(([, v]) => v.trim());
    if (activeFilters.length > 0) {
      result = result.filter((d) => activeFilters.every(([key, val]) => {
        const cell = (d.fields?.[key] || "").toLowerCase();
        return cell.includes(val.trim().toLowerCase());
      }));
    }
    return result;
  }, [normalizedDiffs, colFilters]);

  const totals = useMemo(() => {
    const sums: Record<string, number> = {};
    const counts: Record<string, number> = {};
    for (const col of visibleDiffCols) {
      sums[col.key] = 0;
      counts[col.key] = 0;
      for (const d of filteredDiffs) {
        const n = tryNumber(d.fields?.[col.key] || "");
        if (n !== null) {
          sums[col.key] += n;
          counts[col.key] += 1;
        }
      }
    }
    let baseSum = 0;
    let latestSum = 0;
    let deltaSum = 0;
    for (const d of filteredDiffs) {
      if (levelColumnKey) {
        const level = String(d.fields?.[levelColumnKey] || "").trim();
        if (level !== ".1") continue;
      }
      baseSum += readBaseAmount(d) || 0;
      latestSum += readLatestAmount(d) || 0;
      deltaSum += readDeltaAmount(d) || 0;
    }
    return { sums, counts, baseSum, latestSum, deltaSum };
  }, [filteredDiffs, visibleDiffCols, levelColumnKey]);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/me")
      .then(async (r) => {
        if (!active) return;
        if (r.status === 401) {
          router.replace("/login");
          return;
        }
        if (!r.ok) {
          setErrorMessage("加载用户信息失败");
          setIsLoading(false);
          return;
        }
        setCurrentUser(await r.json() as User);
        setIsLoading(false);
      })
      .catch(() => {
        if (active) {
          setErrorMessage("网络异常");
          setIsLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [router]);

  const refreshList = useCallback(async (q?: string) => {
    const url = q ? `/api/pricing?q=${encodeURIComponent(q)}` : "/api/pricing";
    const r = await fetch(url);
    if (r.status === 401) {
      router.replace("/login");
      return [] as PricingSheetSummary[];
    }
    if (!r.ok) throw new Error("加载失败");
    const data = await r.json() as { items?: PricingSheetSummary[] };
    return Array.isArray(data.items) ? data.items : [];
  }, [router]);

  const loadSheetDetail = useCallback(async (id: string) => {
    if (!id) {
      setSelectedSheet(null);
      return;
    }
    setIsLoadingDetail(true);
    try {
      const r = await fetch(`/api/pricing/${id}`);
      if (r.status === 401) {
        router.replace("/login");
        return;
      }
      if (!r.ok) {
        setSelectedSheet(null);
        return;
      }
      const data = await r.json() as { sheet?: PricingSheet };
      setSelectedSheet(data.sheet || null);
    } catch {
      setSelectedSheet(null);
    } finally {
      setIsLoadingDetail(false);
    }
  }, [router]);

  const loadLogs = useCallback(async (sheetId?: string) => {
    setIsLoadingLogs(true);
    try {
      const url = sheetId ? `/api/pricing/logs?sheetId=${sheetId}` : "/api/pricing/logs";
      const r = await fetch(url);
      if (r.ok) {
        const data = await r.json() as { logs?: PricingLog[] };
        setLogs(data.logs || []);
      }
    } catch {
    } finally {
      setIsLoadingLogs(false);
    }
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    let active = true;
    refreshList()
      .then((items) => {
        if (!active) return;
        setSheetList(items);
        if (!selectedId || !items.some((s) => s.id === selectedId)) {
          setSelectedId(items[0]?.id || "");
        }
      })
      .catch(() => {
        if (active) setErrorMessage("网络异常");
      });
    return () => {
      active = false;
    };
  }, [currentUser, refreshList, selectedId]);

  useEffect(() => {
    if (selectedId) void loadSheetDetail(selectedId);
    setColFilters({});
    setHiddenCols(new Set());
    setColWidths({});
    setShowFilters(false);
    setShowLogs(false);
  }, [selectedId, loadSheetDetail]);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setStatusMessage("请选择Excel文件");
      return;
    }
    setIsUploading(true);
    setStatusMessage("");
    setLastParseInfo(null);
    const fd = new FormData();
    if (sheetKey.trim()) fd.append("sheetKey", sheetKey.trim());
    if (sheetName.trim()) fd.append("sheetName", sheetName.trim());
    fd.append("file", file);
    try {
      const r = await fetch("/api/pricing", { method: "POST", body: fd });
      if (r.status === 401) {
        router.replace("/login");
        return;
      }
      const data = await r.json() as UploadPricingResponse;
      if (!r.ok) {
        let errorMsg = data.message || "上传失败";
        if (data.details) {
          errorMsg += `\n\n详细信息:\n- 总行数: ${data.details.totalRows}\n- 有效行数: ${data.details.contentRows}`;
        }
        setStatusMessage(errorMsg);
        return;
      }
      if (data.parseInfo) setLastParseInfo(data.parseInfo);
      setStatusMessage(
        data.status === "duplicate"
          ? `文件未变化，已忽略（编号：${data.sheetKey || "-"}）`
          : `上传成功（编号：${data.sheetKey || "-"}），解析到 ${data.parseInfo?.itemCount ?? "?"} 条明细`
      );
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      const items = await refreshList();
      setSheetList(items);
      if (data.sheet?.id) {
        setSelectedId(data.sheet.id);
        setSelectedSheet(data.sheet);
      }
    } catch {
      setStatusMessage("网络异常，上传失败");
    } finally {
      setIsUploading(false);
    }
  };

  const onResizeStart = (e: React.MouseEvent, key: string) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = colWidths[key] ?? DEF_COL_W;
    const onMove = (me: MouseEvent) => {
      setColWidths((prev) => ({ ...prev, [key]: Math.max(MIN_COL_W, startW + me.clientX - startX) }));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  if (isLoading) {
    return <div className="min-h-screen bg-[#f5f6f8] flex items-center justify-center text-[#8f959e]"><RefreshCw className="h-4 w-4 animate-spin mr-2" /> 正在加载...</div>;
  }
  if (errorMessage && !currentUser) {
    return <div className="min-h-screen bg-[#f5f6f8] flex items-center justify-center text-[#8f959e]">{errorMessage}</div>;
  }
  if (!currentUser) {
    return <div className="min-h-screen bg-[#f5f6f8] flex items-center justify-center text-[#8f959e]">正在跳转登录...</div>;
  }

  const handleExport = () => {
    if (selectedSheet) window.open(`/api/pricing/export/${selectedSheet.id}`, "_blank");
  };
  const copySheetKey = (key: string) => {
    void navigator.clipboard.writeText(key);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 1500);
  };
  const downloadTemplate = () => {
    const templateData = [
      ["物料编码", "物料名称", "含税单价", "数量", "含税金额"],
      ["MAT001", "螺丝M3*8", "0.05", "100", "5.00"],
      ["MAT002", "垫片3mm", "0.02", "200", "4.00"],
      ["MAT003", "螺母M3", "0.03", "150", "4.50"],
    ];
    const csvContent = templateData.map((row) => row.join(",")).join("\n");
    const blob = new Blob(["\ufeff" + csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", "BOM核价模板.csv");
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const activeFilterCount = Object.values(colFilters).filter((v) => v.trim()).length;
  const totalColSpan = 1 + visibleDiffCols.length;

  return (
    <AppLayout currentUser={currentUser} hideSidebar>
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-6 w-6 text-emerald-600" />
            <h1 className="text-xl font-bold text-[#1f2329]">BOM核价管理</h1>
            <span className="text-xs text-[#8f959e] ml-2">共 {sheetList.length} 个核价单</span>
          </div>
          <div className="flex items-center gap-2">
            {selectedSheet && <Button size="sm" variant="ghost" onClick={handleExport} className="gap-1 text-xs"><Download className="h-3.5 w-3.5" /> 导出Excel</Button>}
            {selectedSheet && <Button size="sm" variant="ghost" onClick={() => setShowVersionModal(true)} className="gap-1 text-xs"><Clock className="h-3.5 w-3.5" /> 版本记录</Button>}
            <Button size="sm" variant="ghost" onClick={() => { setShowLogs((v) => !v); if (!showLogs) void loadLogs(selectedSheet?.id); }} className="gap-1 text-xs"><History className="h-3.5 w-3.5" /> 操作日志</Button>
            <Button size="sm" variant="ghost" onClick={downloadTemplate} className="gap-1 text-xs"><Download className="h-3.5 w-3.5" /> 下载模板</Button>
            <Button size="sm" onClick={() => setShowUpload((v) => !v)}><Upload className="h-4 w-4 mr-1" />{showUpload ? "收起" : "上传BOM"}</Button>
          </div>
        </div>

        {showLogs && (
          <div className="bg-white rounded-xl border border-[#e8eaed] p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-[#1f2329]">操作日志</span>
              <button type="button" onClick={() => setShowLogs(false)} className="text-[#8f959e] hover:text-[#1f2329]"><X className="h-3.5 w-3.5" /></button>
            </div>
            {isLoadingLogs ? <div className="flex items-center gap-2 text-xs text-[#8f959e] py-4 justify-center"><Loader2 className="h-3.5 w-3.5 animate-spin" /> 加载中...</div> : logs.length === 0 ? <div className="text-xs text-[#8f959e] text-center py-4">暂无日志记录（需配置 SQL Server 数据库）</div> : <div className="space-y-1.5 max-h-48 overflow-y-auto">{logs.map((log) => <div key={log.id} className="flex items-center gap-3 text-xs py-1.5 px-2 rounded hover:bg-[#f8f9fb]"><span className={cn("shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium", log.action === "create" ? "bg-blue-50 text-blue-600" : log.action === "upload_version" ? "bg-emerald-50 text-emerald-600" : log.action === "export" ? "bg-amber-50 text-amber-600" : "bg-[#f8f9fb] text-[#646a73]")}>{log.action === "create" ? "创建" : log.action === "upload_version" ? "上传" : log.action === "export" ? "导出" : log.action === "view" ? "查看" : log.action}</span><span className="text-[#1f2329] truncate flex-1">{log.detail || log.sheetKey}</span><span className="shrink-0 text-[#8f959e]">{log.userName}</span><span className="shrink-0 text-[#8f959e]">{new Date(log.createdAt).toLocaleString("zh-CN")}</span></div>)}</div>}
          </div>
        )}

        {showUpload && (
          <div className="bg-white rounded-xl border border-[#e8eaed] p-5 space-y-4">
            <div className="bg-[#f8f9fb] rounded-lg p-3 text-xs text-[#8f959e]">
              <div className="font-medium text-[#1f2329] mb-2">Excel文件格式要求：</div>
              <ul className="space-y-1 ml-4">
                <li>必须包含<strong>物料编码</strong>列（支持：物料编码、物料代码、料号、编码）</li>
                <li>必须包含<strong>金额</strong>或<strong>单价</strong>列</li>
                <li>物料编码不能为空，否则该行会被跳过</li>
                <li>支持 .xlsx 和 .xls 格式</li>
              </ul>
            </div>
            <form onSubmit={handleUpload} className="grid gap-3 md:grid-cols-6 items-end">
              <div className="space-y-1"><Label className="text-xs">核价单编号</Label><Input value={sheetKey} onChange={(e) => setSheetKey(e.target.value)} placeholder="不填自动生成" className="h-8 text-xs" /></div>
              <div className="space-y-1"><Label className="text-xs">核价单名称</Label><Input value={sheetName} onChange={(e) => setSheetName(e.target.value)} placeholder="可选" className="h-8 text-xs" /></div>
              <div className="md:col-span-3 space-y-1"><Label className="text-xs">选择Excel文件（.xlsx / .xls）</Label><Input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={(e) => setFile(e.target.files?.[0] || null)} className="h-8 text-xs" /></div>
              <Button type="submit" className="h-8 text-xs" disabled={isUploading}>{isUploading ? "解析中..." : "上传并解析"}</Button>
            </form>
            {statusMessage && <div className={`rounded-lg px-4 py-3 text-sm whitespace-pre-line ${statusMessage.includes("上传成功") || statusMessage.includes("文件未变化") ? "bg-emerald-50 text-emerald-600 border border-emerald-200" : "bg-red-50 text-red-600 border border-red-200"}`}>{statusMessage}</div>}
            {lastParseInfo && <details className="text-xs text-[#8f959e]"><summary className="cursor-pointer hover:text-[#1f2329]">解析详情</summary><div className="mt-2 ml-4 space-y-1"><div>解析条数: {lastParseInfo.itemCount}</div></div></details>}
            <p className="text-xs text-[#8f959e]">相同编号再次上传会自动生成新版本，历史版本可通过“版本记录”按钮查看。</p>
          </div>
        )}

        {sheetList.length > 0 ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="relative max-w-xs flex-1"><Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#8f959e]" /><Input value={sheetKeyword} onChange={(e) => setSheetKeyword(e.target.value)} placeholder="搜索BOM编号、名称..." className="h-8 text-xs pl-8" /></div>
              <span className="text-xs text-[#8f959e]">显示 {visibleSheets.length} / {sheetList.length}</span>
            </div>
            <div className="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-thin">{visibleSheets.map((s) => { const active = s.id === selectedId; return <button key={s.id} type="button" onClick={() => setSelectedId(s.id)} className={cn("shrink-0 px-4 py-2 rounded-t-lg text-sm font-medium border border-b-0 transition-all whitespace-nowrap", active ? "bg-white text-[#1f2329] border-[#e8eaed] shadow-sm" : "bg-transparent text-[#8f959e] border-transparent hover:bg-[#f8f9fb] hover:text-[#1f2329]")}>{s.name || s.key}{s.versionCount > 1 && <span className="ml-1.5 text-xs opacity-60">V{s.latestVersionNo}</span>}</button>; })}<button type="button" onClick={() => setShowUpload(true)} className="shrink-0 px-3 py-2 text-xs text-[#8f959e] hover:text-[#1f2329] transition-colors"><Plus className="h-3.5 w-3.5" /></button></div>
            {visibleSheets.length === 0 && <div className="text-xs text-[#8f959e] px-1">没有匹配的BOM，请换个关键字</div>}
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-[#e8eaed] p-10 text-center"><FileSpreadsheet className="h-10 w-10 mx-auto text-[#8f959e] mb-3" /><div className="font-semibold text-[#1f2329] mb-1">暂无核价单</div><p className="text-sm text-[#8f959e] mb-3">上传第一份BOM Excel开始核价</p><Button size="sm" onClick={() => setShowUpload(true)}><Upload className="h-4 w-4 mr-1" /> 上传BOM</Button></div>
        )}

        {isLoadingDetail && <div className="bg-white rounded-xl border border-[#e8eaed] p-8 flex items-center justify-center gap-2 text-xs text-[#8f959e]"><Loader2 className="h-4 w-4 animate-spin" /> 加载核价单详情...</div>}

        {selectedSheet && !isLoadingDetail && (
          <>
            <div className="bg-white rounded-xl border border-[#e8eaed] px-4 py-2.5 flex flex-wrap items-center gap-x-6 gap-y-1 text-xs">
              <span className="text-[#8f959e] flex items-center gap-1">
                当前核价单：
                <strong className="text-[#1f2329] font-mono">{selectedSheet.key}</strong>
                <button type="button" onClick={() => copySheetKey(selectedSheet.key)} title="复制编号" className="text-[#8f959e] hover:text-[#1f2329] transition-colors"><ClipboardCopy className="h-3 w-3" /></button>
                {copiedKey && <span className="text-emerald-500 text-[10px]">已复制</span>}
              </span>
              <span className="text-[#8f959e]">明细字段: <strong className="text-[#1f2329]">{visibleDiffCols.length}</strong></span>
              <span className="text-[#8f959e]">数据行: <strong className="text-[#1f2329]">{filteredDiffs.length}</strong></span>
            </div>

            {visibleMainCols.length > 0 && (
              <div className="bg-white rounded-xl border border-[#e8eaed] overflow-hidden">
                <div className="px-4 py-2 border-b border-[#e8eaed] bg-[#f8f9fb] flex items-center gap-2">
                  <span className="text-xs font-semibold text-[#1f2329]">主表信息</span>
                  <span className="text-[11px] text-[#8f959e]">{selectedSheet.name || selectedSheet.key}</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead className="bg-[#f8f9fb] text-[#8f959e]">
                      <tr>
                        {visibleMainCols.map((c) => (
                          <th key={c.key} className="px-3 py-2 text-left font-medium whitespace-nowrap border-r border-b border-[#e8eaed] last:border-r-0">{c.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        {visibleMainCols.map((c) => (
                          <td key={c.key} className="px-3 py-2 text-[#1f2329] whitespace-nowrap border-r border-b border-[#e8eaed] last:border-r-0 max-w-[240px] truncate">{selectedSheet.mainFields?.[c.key] || "-"}</td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="bg-white rounded-xl border border-[#e8eaed] overflow-hidden">
              <div className="px-4 py-2 border-b border-[#e8eaed] bg-[#f8f9fb] flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-[#1f2329] flex items-center gap-1.5 mr-2">
                  <GitCompare className="h-3.5 w-3.5 text-emerald-500" /> 明细物料对比
                </span>
                <div className="flex-1" />
                <button type="button" onClick={() => setShowFilters((v) => !v)} className={cn("flex items-center gap-1 px-2 py-1 rounded text-xs transition-all", showFilters ? "bg-blue-100 text-blue-700" : "text-[#8f959e] hover:text-[#1f2329]")}>
                  <Filter className="h-3 w-3" /> 筛选{activeFilterCount > 0 && ` (${activeFilterCount})`}
                </button>
                {activeFilterCount > 0 && (
                  <button type="button" onClick={() => setColFilters({})} className="text-xs text-red-500 hover:text-red-700 flex items-center gap-0.5">
                    <X className="h-3 w-3" /> 清除
                  </button>
                )}
                <div className="relative">
                  <button type="button" onClick={() => setShowColMenu((v) => !v)} className="flex items-center gap-1 px-2 py-1 rounded text-xs text-[#8f959e] hover:text-[#1f2329]">
                    <Columns className="h-3 w-3" /> 列{hiddenCols.size > 0 && <span className="text-amber-600">(-{hiddenCols.size})</span>}
                  </button>
                  {showColMenu && (
                    <div className="absolute right-0 top-full mt-1 z-30 bg-white border border-[#e8eaed] rounded-lg shadow-[0_8px_24px_rgba(31,35,41,0.1)] p-2 w-56 max-h-72 overflow-y-auto">
                      <div className="flex items-center justify-between mb-2 px-1">
                        <span className="text-xs font-semibold text-[#1f2329]">显示/隐藏列</span>
                        <div className="flex gap-1">
                          <button type="button" onClick={() => setHiddenCols(new Set())} className="text-[10px] text-blue-600 hover:underline">全显示</button>
                          <button type="button" onClick={() => setShowColMenu(false)} className="text-[10px] text-[#8f959e] hover:text-[#1f2329]">关闭</button>
                        </div>
                      </div>
                      {diffColumns.map((c) => {
                        const hidden = hiddenCols.has(c.key);
                        return (
                          <button
                            key={c.key}
                            type="button"
                            onClick={() => setHiddenCols((prev) => {
                              const next = new Set(prev);
                              if (hidden) next.delete(c.key);
                              else next.add(c.key);
                              return next;
                            })}
                            className="w-full flex items-center justify-between px-2 py-1.5 rounded text-xs hover:bg-[#f8f9fb]"
                          >
                            <span className={cn("truncate pr-2", hidden && "line-through text-[#8f959e]")}>{c.label}</span>
                            {hidden ? <EyeOff className="h-3.5 w-3.5 text-[#c9cdd4]" /> : <Eye className="h-3.5 w-3.5 text-emerald-500" />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                <span className="text-xs text-[#8f959e]">{filteredDiffs.length}行</span>
              </div>

              <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
                <table className="w-full text-xs border-collapse">
                  <thead className="bg-[#f8f9fb] text-[#8f959e] sticky top-0 z-10">
                    <tr>
                      <th className="px-2 py-2 text-center font-medium w-10 border-r border-b border-[#e8eaed] sticky left-0 bg-[#f8f9fb] z-20">#</th>
                      {visibleDiffCols.map((c) => (
                        <th
                          key={c.key}
                          className="relative px-2 py-2 text-left font-medium whitespace-nowrap border-r border-b border-[#e8eaed]"
                          style={{ width: colWidths[c.key] ?? DEF_COL_W, minWidth: MIN_COL_W }}
                        >
                          <div className="pr-2 truncate">{c.label}</div>
                          <div className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-blue-400/40 transition-colors" onMouseDown={(e) => onResizeStart(e, c.key)} />
                        </th>
                      ))}
                    </tr>
                    {showFilters && (
                      <tr>
                        <th className="px-1 py-1 border-r border-b border-[#e8eaed] sticky left-0 bg-[#f8f9fb] z-20" />
                        {visibleDiffCols.map((c) => (
                          <th key={c.key} className="px-1 py-1 border-r border-b border-[#e8eaed]">
                            <input
                              type="text"
                              placeholder="筛选..."
                              value={colFilters[c.key] || ""}
                              onChange={(e) => setColFilters((prev) => ({ ...prev, [c.key]: e.target.value }))}
                              className="w-full h-6 px-1.5 text-[11px] rounded border border-[#e8eaed] bg-white text-[#1f2329] outline-none focus:ring-1 focus:ring-blue-400"
                            />
                          </th>
                        ))}
                      </tr>
                    )}
                  </thead>
                  <tbody>
                    {filteredDiffs.length === 0 ? (
                      <tr>
                        <td className="px-4 py-8 text-center text-[#8f959e]" colSpan={totalColSpan}>暂无数据</td>
                      </tr>
                    ) : (
                      filteredDiffs.map((d, i) => (
                        <tr key={`${d.materialCode}-${i}`} className={cn("hover:bg-[#f8f9fb] transition-colors", rowBg(d.status))}>
                          <td className="px-2 py-1.5 text-center text-[#8f959e] border-r border-b border-[#e8eaed] sticky left-0 bg-white z-[5]">{i + 1}</td>
                          {visibleDiffCols.map((c) => (
                            <td
                              key={c.key}
                              className="px-2 py-1.5 whitespace-nowrap border-r border-b border-[#e8eaed] text-[#1f2329]"
                              style={{ width: colWidths[c.key] ?? DEF_COL_W, minWidth: MIN_COL_W, maxWidth: colWidths[c.key] ?? DEF_COL_W }}
                            >
                              <div className="truncate">{d.fields?.[c.key] || "-"}</div>
                            </td>
                          ))}
                        </tr>
                      ))
                    )}
                    <tr className="bg-[#f8f9fb] font-semibold">
                      <td className="px-2 py-2 text-right text-[#1f2329] border-r border-t-2 border-[#e8eaed] sticky left-0 bg-[#f8f9fb] z-[5]">合计</td>
                      {visibleDiffCols.map((c) => (
                        <td key={c.key} className="px-2 py-2 whitespace-nowrap border-r border-t-2 border-[#e8eaed] text-[#1f2329]">
                          {totals.counts[c.key] > 0 ? totals.sums[c.key].toFixed(2) : "-"}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {showVersionModal && selectedSheet && <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"><div className="bg-white rounded-xl border border-[#e8eaed] max-w-2xl w-full max-h-[80vh] overflow-hidden"><div className="px-5 py-3.5 border-b border-[#e8eaed] flex items-center justify-between bg-[#f8f9fb]"><h3 className="text-sm font-semibold text-[#1f2329] flex items-center gap-2"><Clock className="h-4 w-4 text-blue-500" />版本记录 - {selectedSheet.key}</h3><button type="button" onClick={() => setShowVersionModal(false)} className="text-[#8f959e] hover:text-[#1f2329] transition-colors"><X className="h-4 w-4" /></button></div><div className="p-4 max-h-[60vh] overflow-y-auto"><div className="relative pl-6 space-y-3"><div className="absolute left-2 top-1 bottom-1 w-px bg-[#e8eaed]" />{selectedSheet.versions.map((v) => { const isB = v.id === selectedSheet.baseVersionId; const isL = v.id === selectedSheet.latestVersionId; return <div key={v.id} className="relative flex items-center gap-2 text-xs"><div className={cn("absolute -left-4 w-2.5 h-2.5 rounded-full border-2", isL ? "bg-emerald-500 border-emerald-300" : isB ? "bg-blue-500 border-blue-300" : "bg-white border-[#e8eaed]")} /><span className={cn("font-bold px-1.5 py-0.5 rounded", isL ? "bg-emerald-100 text-emerald-700" : isB ? "bg-blue-100 text-blue-700" : "bg-[#f0f1f3] text-[#646a73]")}>V{v.versionNo}</span>{isB && <span className="text-blue-500">首版</span>}{isL && !isB && <span className="text-emerald-500">最新</span>}<span className="text-[#8f959e]">{v.fileName} · {new Date(v.uploadedAt).toLocaleString("zh-CN")}{v.uploadedByName && <> · <strong className="text-[#1f2329]">{v.uploadedByName}</strong></>}{!v.uploadedByName && v.uploadedBy && <> · {v.uploadedBy}</>} {" "}· {v.items.length}条</span></div>; })}</div></div></div></div>}
      </div>
    </AppLayout>
  );

}
