"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, Users, FolderPlus, ListTodo, FileSpreadsheet, TrendingUp, Target, Activity, ArrowRight, CheckCircle2, Circle, ChevronRight } from "lucide-react";
import { Project, User } from "@/types";
import { useRouter } from "next/navigation";
import AppLayout from "@/components/AppLayout";
import { useDataCache } from "@/hooks/useDataCache";

type ProjectSummary = Project & { taskCount: number };

export default function Dashboard() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [pricingStats, setPricingStats] = useState<{ totalSheets: number; totalVersions: number; recentUpdates: number }>({ totalSheets: 0, totalVersions: 0, recentUpdates: 0 });

  const TARGET_REDUCTION_RATE = 0.3;

  const formatCurrency = (amount: number) => {
    const fixed = amount.toFixed(2);
    const parts = fixed.split(".");
    const withCommas = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return `¥${withCommas}.${parts[1]}`;
  };

  const projectBaselineCost = (project: ProjectSummary) => {
    const seed = `${project.id}|${project.name}|${project.type}|${project.departmentId || ""}`;
    let hash = 0;
    for (let i = 0; i < seed.length; i += 1) {
      hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
    }
    const base = 800 + (hash % 2600);
    const taskBump = Math.min(1200, (project.taskCount || 0) * 120);
    return base + taskBump;
  };

  const projectReductionRate = (project: ProjectSummary) => {
    const p = Number.isFinite(project.progress) ? project.progress : 0;
    const ratio = Math.min(1, Math.max(0, p / 100));
    return Math.min(TARGET_REDUCTION_RATE, TARGET_REDUCTION_RATE * ratio);
  };

  const projectFinance = useMemo(() => {
    const byId: Record<
      string,
      { baseline: number; current: number; savings: number; rate: number }
    > = {};
    for (const project of projects) {
      const baseline = projectBaselineCost(project);
      const rate = projectReductionRate(project);
      const current = baseline * (1 - rate);
      const savings = baseline - current;
      byId[project.id] = { baseline, current, savings, rate };
    }
    return byId;
  }, [projects]);

  const fetchCurrentUser = useCallback(async () => {
    const response = await fetch("/api/auth/me");
    if (response.status === 401) {
      throw new Error("UNAUTHORIZED");
    }
    if (!response.ok) {
      throw new Error("LOAD_USER_FAILED");
    }
    return (await response.json()) as User;
  }, []);

  const fetchProjectSummary = useCallback(async () => {
    const response = await fetch("/api/projects?summary=1");
    if (response.status === 401) {
      throw new Error("UNAUTHORIZED");
    }
    if (!response.ok) {
      throw new Error("LOAD_PROJECTS_FAILED");
    }
    return (await response.json()) as ProjectSummary[];
  }, []);

  const { fetch: loadUserFromCache } = useDataCache<User>("auth:me", fetchCurrentUser, { ttl: 2 * 60 * 1000 });
  const { fetch: loadProjectsFromCache } = useDataCache<ProjectSummary[]>("projects:summary", fetchProjectSummary, { ttl: 60 * 1000 });

  const recentProjects = useMemo(() => [...projects].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 8), [projects]);

  const totals = useMemo(() => {
    let baseline = 0;
    let current = 0;
    let savings = 0;
    let taskCount = 0;
    let avgProgress = 0;
    for (const p of projects) {
      const f = projectFinance[p.id];
      baseline += f?.baseline || 0;
      current += f?.current || 0;
      savings += f?.savings || 0;
      taskCount += p.taskCount || 0;
      avgProgress += Number.isFinite(p.progress) ? p.progress : 0;
    }
    const avgRate = baseline > 0 ? savings / baseline : 0;
    const avgProgressValue = projects.length > 0 ? avgProgress / projects.length : 0;
    return { baseline, current, savings, avgRate, taskCount, avgProgress: avgProgressValue };
  }, [projectFinance, projects]);

  const projectStatus = useMemo(() => {
    let notStarted = 0;
    let active = 0;
    let completed = 0;
    for (const p of projects) {
      const progress = Number.isFinite(p.progress) ? p.progress : 0;
      if (progress >= 100) completed += 1;
      else if (progress <= 0) notStarted += 1;
      else active += 1;
    }
    const total = projects.length || 1;
    return {
      total: projects.length,
      notStarted,
      active,
      completed,
      notStartedPct: (notStarted / total) * 100,
      activePct: (active / total) * 100,
      completedPct: (completed / total) * 100,
    };
  }, [projects]);

  useEffect(() => {
    let active = true;
    
    // 并行加载用户信息和项目数据
    const loadData = async () => {
      if (!active) return;
      setIsLoading(true);
      setErrorMessage("");
      
      try {
        const [user, projectData] = await Promise.all([
          loadUserFromCache(),
          loadProjectsFromCache(),
        ]);
        
        if (!active) return;
        
        setCurrentUser(user);
        setProjects(projectData);
        setIsLoading(false);
        
        // 后台异步加载pricing统计，不阻塞页面渲染
        Promise.resolve()
          .then(async () => {
            const pr = await fetch("/api/pricing");
            if (pr.ok) {
              const pd = await pr.json() as { items?: unknown[] };
              const items = Array.isArray(pd.items) ? pd.items : [];
              setPricingStats({ totalSheets: items.length, totalVersions: 0, recentUpdates: 0 });
            }
          })
          .catch(() => {
            // 静默处理pricing统计加载失败
          });
          
      } catch (error) {
        if (!active) return;
        if (error instanceof Error && error.message === "UNAUTHORIZED") {
          setErrorMessage("未登录，正在跳转...");
          router.replace("/login");
          return;
        }
        if (error instanceof Error && error.message === "LOAD_USER_FAILED") {
          setErrorMessage("加载用户信息失败");
          setIsLoading(false);
          return;
        }
        if (error instanceof Error && error.message === "LOAD_PROJECTS_FAILED") {
          setErrorMessage("加载项目列表失败");
          setIsLoading(false);
          return;
        }
        console.error("Failed to load dashboard data:", error);
        setErrorMessage("网络异常，加载失败");
        setIsLoading(false);
      }
    };
    
    loadData();
    
    return () => {
      active = false;
    };
  }, [loadProjectsFromCache, loadUserFromCache, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#f5f6f8] flex items-center justify-center text-[#8f959e]">
        正在加载数据...
      </div>
    );
  }

  if (errorMessage) {
    return (
      <div className="min-h-screen bg-[#f5f6f8] flex items-center justify-center text-[#8f959e]">
        {errorMessage}
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-[#f5f6f8] flex items-center justify-center text-[#8f959e]">
        正在跳转登录...
      </div>
    );
  }

  return (
    <AppLayout currentUser={currentUser}>
      {errorMessage && (
        <div className="mb-4 flex items-center gap-2 rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-600">
          {errorMessage}
        </div>
      )}

      {/* Page Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-[22px] font-bold text-[#1f2329] tracking-tight">工作台</h1>
          <p className="text-sm text-[#8f959e] mt-0.5">
            欢迎回来，{currentUser.name} · 降本项目管控平台
          </p>
        </div>
        <div className="hidden sm:flex items-center gap-2 text-xs text-[#8f959e] bg-white border border-[#e8eaed] px-3 py-1.5 rounded-lg shadow-sm">
          <Target className="h-3.5 w-3.5 text-[#3370ff]" />
          <span>目标节约率</span>
          <strong className="text-[#1f2329]">30%</strong>
          <span className="mx-1 text-[#d8dee8]">|</span>
          <Activity className="h-3.5 w-3.5 text-emerald-500" />
          <span>活跃</span>
          <strong className="text-emerald-600">{projectStatus.active}</strong>
          <span>个</span>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-2xl border border-[#e8eaed] p-5 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between mb-3">
            <div className="h-9 w-9 rounded-xl bg-[#eaf0ff] flex items-center justify-center">
              <FolderPlus className="h-4.5 w-4.5 text-[#3370ff]" style={{ width: 18, height: 18 }} />
            </div>
            <div className="flex items-center gap-1 text-[11px] text-emerald-600 font-medium">
              <TrendingUp className="h-3 w-3" />{projectStatus.active} 进行中
            </div>
          </div>
          <div className="text-2xl font-bold text-[#1f2329]">{projects.length}</div>
          <div className="text-xs text-[#8f959e] mt-0.5">总项目数</div>
          <div className="mt-3 h-1.5 bg-[#f0f1f3] rounded-full overflow-hidden">
            <div className="h-full bg-[#3370ff] rounded-full" style={{ width: `${Math.min(100, projectStatus.activePct + projectStatus.completedPct)}%` }} />
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-[#e8eaed] p-5 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between mb-3">
            <div className="h-9 w-9 rounded-xl bg-[#e6faf3] flex items-center justify-center">
              <Building2 style={{ width: 18, height: 18 }} className="text-emerald-600" />
            </div>
            <span className="text-[11px] text-[#8f959e]">累计节约</span>
          </div>
          <div className="text-2xl font-bold text-[#1f2329]">{formatCurrency(totals.savings)}</div>
          <div className="text-xs text-[#8f959e] mt-0.5">降本金额（估算）</div>
          <div className="mt-3 h-1.5 bg-[#f0f1f3] rounded-full overflow-hidden">
            <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${Math.min(100, (totals.avgRate / 0.3) * 100)}%` }} />
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-[#e8eaed] p-5 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between mb-3">
            <div className="h-9 w-9 rounded-xl bg-[#fff8e6] flex items-center justify-center">
              <Users style={{ width: 18, height: 18 }} className="text-amber-500" />
            </div>
            <span className="text-[11px] font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-100">目标 30%</span>
          </div>
          <div className="text-2xl font-bold text-[#1f2329]">{(totals.avgRate * 100).toFixed(1)}%</div>
          <div className="text-xs text-[#8f959e] mt-0.5">平均节约率</div>
          <div className="mt-3 h-1.5 bg-[#f0f1f3] rounded-full overflow-hidden">
            <div className="h-full bg-amber-400 rounded-full" style={{ width: `${Math.min(100, (totals.avgRate / 0.3) * 100)}%` }} />
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-[#e8eaed] p-5 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between mb-3">
            <div className="h-9 w-9 rounded-xl bg-[#f3f0ff] flex items-center justify-center">
              <ListTodo style={{ width: 18, height: 18 }} className="text-violet-500" />
            </div>
            <span className="text-[11px] text-[#8f959e]">平均进度 {totals.avgProgress.toFixed(0)}%</span>
          </div>
          <div className="text-2xl font-bold text-[#1f2329]">{totals.taskCount}</div>
          <div className="text-xs text-[#8f959e] mt-0.5">累计任务数</div>
          <div className="mt-3 h-1.5 bg-[#f0f1f3] rounded-full overflow-hidden">
            <div className="h-full bg-violet-400 rounded-full" style={{ width: `${Math.min(100, totals.avgProgress)}%` }} />
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Left: Project List */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-[#e8eaed] shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-[#f0f1f3] flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[#1f2329] flex items-center gap-2">
              <FolderPlus className="h-4 w-4 text-[#3370ff]" />
              近期项目
            </h3>
            <button type="button" onClick={() => router.push("/projects")}
              className="flex items-center gap-1 text-xs text-[#3370ff] hover:text-[#245bdb] font-medium transition-colors">
              全部 <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
          {recentProjects.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <FolderPlus className="h-10 w-10 mx-auto mb-3 text-[#c9cdd4]" />
              <div className="text-sm text-[#8f959e]">暂无项目</div>
              <button type="button" onClick={() => router.push("/projects/new")}
                className="mt-3 text-xs text-[#3370ff] hover:underline">
                新建项目
              </button>
            </div>
          ) : (
            <div className="divide-y divide-[#f5f6f8]">
              {recentProjects.map((project) => {
                const progress = Number.isFinite(project.progress) ? project.progress : 0;
                const isCompleted = progress >= 100;
                const isActive = progress > 0 && progress < 100;
                return (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => router.push(`/project/${project.id}`)}
                    className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-[#f8f9fb] transition-colors text-left group"
                  >
                    <div className="shrink-0">
                      {isCompleted ? (
                        <CheckCircle2 className="h-4.5 w-4.5 text-emerald-500" style={{ width: 18, height: 18 }} />
                      ) : isActive ? (
                        <div className="h-[18px] w-[18px] rounded-full border-2 border-[#3370ff] border-t-transparent animate-none relative">
                          <div className="absolute inset-0.5 rounded-full bg-[#eaf0ff]" />
                        </div>
                      ) : (
                        <Circle className="h-4.5 w-4.5 text-[#c9cdd4]" style={{ width: 18, height: 18 }} />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-sm font-medium text-[#1f2329] truncate group-hover:text-[#3370ff] transition-colors">
                          {project.name}
                        </span>
                        <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded font-medium ${project.type === 'company' ? 'bg-purple-50 text-purple-600' : 'bg-blue-50 text-blue-600'}`}>
                          {project.type === 'company' ? '公司级' : '部门级'}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex-1 h-1 bg-[#f0f1f3] rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${isCompleted ? 'bg-emerald-500' : 'bg-[#3370ff]'}`}
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                        <span className={`shrink-0 text-[11px] font-medium ${isCompleted ? 'text-emerald-600' : isActive ? 'text-[#3370ff]' : 'text-[#8f959e]'}`}>
                          {progress}%
                        </span>
                      </div>
                    </div>
                    <div className="shrink-0 text-xs text-[#8f959e] hidden sm:block">
                      {project.taskCount > 0 ? `${project.taskCount} 项任务` : '暂无任务'}
                    </div>
                    <ArrowRight className="h-3.5 w-3.5 text-[#c9cdd4] opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: Status + BOM */}
        <div className="space-y-4">
          {/* Status Distribution */}
          <div className="bg-white rounded-2xl border border-[#e8eaed] shadow-sm p-5">
            <h3 className="text-sm font-semibold text-[#1f2329] mb-4 flex items-center gap-2">
              <Activity className="h-4 w-4 text-violet-500" />
              项目状态
            </h3>
            <div className="space-y-3">
              {[
                { label: '进行中', count: projectStatus.active, pct: projectStatus.activePct, color: 'bg-[#3370ff]', textColor: 'text-[#3370ff]' },
                { label: '已完成', count: projectStatus.completed, pct: projectStatus.completedPct, color: 'bg-emerald-500', textColor: 'text-emerald-600' },
                { label: '未启动', count: projectStatus.notStarted, pct: projectStatus.notStartedPct, color: 'bg-[#c9cdd4]', textColor: 'text-[#8f959e]' },
              ].map((item) => (
                <div key={item.label} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      <div className={`h-2 w-2 rounded-full ${item.color}`} />
                      <span className="text-[#646a73]">{item.label}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`font-semibold ${item.textColor}`}>{item.count}</span>
                      <span className="text-[#c9cdd4]">{Math.round(item.pct)}%</span>
                    </div>
                  </div>
                  <div className="h-1.5 bg-[#f0f1f3] rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all duration-500 ${item.color}`} style={{ width: `${item.pct}%` }} />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 pt-3 border-t border-[#f5f6f8] flex items-center justify-between text-xs text-[#8f959e]">
              <span>完成率</span>
              <strong className="text-emerald-600">{Math.round(projectStatus.completedPct)}%</strong>
            </div>
          </div>

          {/* BOM Pricing Entry */}
          <button
            type="button"
            onClick={() => router.push("/pricing")}
            className="group w-full bg-gradient-to-br from-[#3370ff] to-[#5b55e8] rounded-2xl p-5 text-left text-white shadow-sm hover:shadow-lg transition-all duration-300 relative overflow-hidden"
          >
            <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/10 group-hover:scale-110 transition-transform duration-300" />
            <div className="relative z-10">
              <div className="flex items-center justify-between mb-3">
                <div className="h-9 w-9 rounded-xl bg-white/20 flex items-center justify-center">
                  <FileSpreadsheet style={{ width: 18, height: 18 }} />
                </div>
                <ArrowRight className="h-4 w-4 opacity-50 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
              </div>
              <div className="text-2xl font-bold mb-1">{pricingStats.totalSheets}</div>
              <div className="text-white/80 text-sm mb-2">BOM 核价单</div>
              <div className="flex items-center gap-2 text-[11px] text-white/60">
                <span>智能解析</span>
                <span>·</span>
                <span>版本对比</span>
                <span>·</span>
                <span>差异分析</span>
              </div>
            </div>
          </button>
        </div>
      </div>

    </AppLayout>
  );
}
