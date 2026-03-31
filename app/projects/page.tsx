"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Building2, CalendarDays, Plus, Target, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/Button";
import AppLayout from "@/components/AppLayout";
import { Project, User } from "@/types";
import { useDataCache } from "@/hooks/useDataCache";

type ProjectSummary = Project & { taskCount: number; completedTaskCount?: number };

const bomChangeLabel = (type?: ProjectSummary["bomChangeType"]) => {
  if (type === "replace") return "产品替换";
  if (type === "materialAdjust") return "客户BOM替换";
  if (type === "rawMaterialReplace") return "原材料替换";
  return "未设置";
};

export default function ProjectListPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  const canCreate = currentUser?.role === "admin" || currentUser?.role === "manager";

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

  const canDeleteProject = (project: ProjectSummary) => {
    if (!currentUser) return false;
    if (currentUser.role === "admin") return true;
    if (currentUser.role === "manager") {
      return project.type === "department" && project.departmentId === currentUser.departmentId;
    }
    return false;
  };

  useEffect(() => {
    let active = true;

    const loadData = async () => {
      setIsLoading(true);
      setErrorMessage("");
      try {
        const [user, projectData] = await Promise.all([loadUserFromCache(), loadProjectsFromCache()]);

        if (!active) return;
        setCurrentUser(user);
        setProjects(Array.isArray(projectData) ? projectData : []);
        setIsLoading(false);
      } catch (error) {
        if (!active) return;
        if (error instanceof Error && error.message === "UNAUTHORIZED") {
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
        setErrorMessage("网络异常，加载失败");
        setIsLoading(false);
      }
    };

    void loadData();
    return () => {
      active = false;
    };
  }, [loadProjectsFromCache, loadUserFromCache, router]);

  const handleDeleteProject = async (id: string) => {
    if (!confirm("确定要删除这个项目吗？")) return;

    setErrorMessage("");
    const response = await fetch(`/api/projects/${id}`, { method: "DELETE" });
    if (response.status === 401) {
      router.replace("/login");
      return;
    }
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { message?: string };
      setErrorMessage(data.message || "删除项目失败");
      return;
    }
    setProjects((prev) => prev.filter((p) => p.id !== id));
  };

  const totals = useMemo(() => {
    const total = projects.length;
    const completed = projects.filter((p) => (Number.isFinite(p.progress) ? p.progress : 0) >= 100).length;
    const avgProgress =
      total > 0
        ? projects.reduce((sum, p) => sum + (Number.isFinite(p.progress) ? p.progress : 0), 0) / total
        : 0;
    return { total, completed, avgProgress };
  }, [projects]);

  if (isLoading) {
    return <div className="min-h-screen bg-[#f5f6f8] flex items-center justify-center text-[#8f959e]">正在加载数据...</div>;
  }

  if (errorMessage && !currentUser) {
    return <div className="min-h-screen bg-[#f5f6f8] flex items-center justify-center text-[#8f959e]">{errorMessage}</div>;
  }

  if (!currentUser) {
    return <div className="min-h-screen bg-[#f5f6f8] flex items-center justify-center text-[#8f959e]">正在跳转登录...</div>;
  }

  return (
    <AppLayout currentUser={currentUser}>
      <div className="space-y-5">
        {errorMessage ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">{errorMessage}</div>
        ) : null}

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-xl font-bold text-[#1f2329] tracking-tight">项目管理</h2>
            <p className="text-sm text-[#8f959e] mt-0.5">查看项目进度与立项信息</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-xs text-[#8f959e] bg-white rounded-lg border border-[#e8eaed] px-3 py-1.5">
              共 {totals.total} 个项目 · 平均进度 {totals.avgProgress.toFixed(1)}% · 完成 {totals.completed}
            </div>
            {canCreate ? (
              <Button size="sm" onClick={() => router.push("/projects/new")} className="gap-1">
                <Plus className="h-4 w-4" /> 新建项目
              </Button>
            ) : null}
          </div>
        </div>

        {projects.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-xl border border-[#e8eaed] text-[#8f959e]">暂无可见项目</div>
        ) : (
          <>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {projects.map((project) => {
                const progress = Number.isFinite(project.progress) ? project.progress : 0;
                const canDelete = canDeleteProject(project);
                const completed = Number.isFinite(project.completedTaskCount || 0)
                  ? (project.completedTaskCount as number)
                  : 0;
                const isDone = progress >= 100;

                return (
                  <div
                    key={project.id}
                    className="bg-white rounded-xl border border-[#e8eaed] hover:shadow-[0_4px_16px_rgba(31,35,41,0.06)] transition-all group"
                  >
                    <div className="p-5 space-y-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[15px] font-semibold text-[#1f2329] truncate">{project.name}</span>
                            <span
                              className={`shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded ${
                                isDone
                                  ? "bg-emerald-50 text-emerald-600"
                                  : progress > 0
                                    ? "bg-blue-50 text-blue-600"
                                    : "bg-slate-50 text-slate-500"
                              }`}
                            >
                              {isDone ? "已完成" : progress > 0 ? "进行中" : "未启动"}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 mt-1 text-xs text-[#8f959e]">
                            <span>#{project.id}</span>
                            <span>·</span>
                            <span className="inline-flex items-center gap-0.5">
                              {project.type === "company" ? (
                                <>
                                  <Building2 className="h-3 w-3" /> 公司级
                                </>
                              ) : (
                                <>
                                  <Users className="h-3 w-3" /> 部门级
                                </>
                              )}
                            </span>
                          </div>
                        </div>

                        {canDelete ? (
                          <button
                            onClick={() => void handleDeleteProject(project.id)}
                            className="h-7 w-7 rounded-lg flex items-center justify-center text-[#8f959e] hover:text-red-500 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100"
                            aria-label="删除项目"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                      </div>

                      <div>
                        <div className="flex items-center justify-between text-xs mb-1.5">
                          <span className="text-[#8f959e]">进度</span>
                          <span className="font-semibold text-[#1f2329]">{progress}%</span>
                        </div>
                        <div className="h-1.5 w-full bg-[#f0f1f3] rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${isDone ? "bg-emerald-500" : "bg-[#3370ff]"}`}
                            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="text-[#8f959e] flex items-center gap-1"><CalendarDays className="h-3 w-3" /> 周期</span>
                          <span className="text-[#1f2329]">{project.cycle || "-"}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[#8f959e] flex items-center gap-1"><Users className="h-3 w-3" /> 发起人</span>
                          <span className="text-[#1f2329]">{project.initiator || "-"}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[#8f959e]">任务</span>
                          <span className="text-[#1f2329]">{completed}/{project.taskCount}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[#8f959e] flex items-center gap-1"><Target className="h-3 w-3" /> 类别</span>
                          <span className="text-[#1f2329]">{bomChangeLabel(project.bomChangeType)}</span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-3 border-t border-[#f0f1f3]">
                        <div className="text-[11px] text-[#8f959e] truncate max-w-[60%]">效益: {project.benefit || "待评估"}</div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1 text-xs h-7 px-3 rounded-lg text-[#3370ff] hover:bg-blue-50"
                          onClick={() => router.push(`/project/${project.id}`)}
                        >
                          查看详情 <ArrowRight className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="bg-white rounded-xl border border-[#e8eaed] overflow-hidden">
              <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-[#e8eaed] bg-[#f8f9fb]">
                <div>
                  <div className="text-sm font-semibold text-[#1f2329]">降本立项汇总表</div>
                  <div className="text-xs text-[#8f959e]">含行动措施字段，便于检查缺失项</div>
                </div>
                <div className="text-xs text-[#8f959e]">共 {projects.length} 项</div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[#f8f9fb] text-xs text-[#8f959e]">
                    <tr>
                      <th className="px-4 py-2 text-center font-medium">序号</th>
                      <th className="px-4 py-2 text-left font-medium">项目编号</th>
                      <th className="px-4 py-2 text-left font-medium">项目名称</th>
                      <th className="px-4 py-2 text-left font-medium">发起人/小组</th>
                      <th className="px-4 py-2 text-left font-medium">问题描述/机会点</th>
                      <th className="px-4 py-2 text-left font-medium">项目目标 (SMART)</th>
                      <th className="px-4 py-2 text-left font-medium">主要行动措施</th>
                      <th className="px-4 py-2 text-left font-medium">资源需求</th>
                      <th className="px-4 py-2 text-left font-medium">项目周期</th>
                      <th className="px-4 py-2 text-left font-medium">效益测算</th>
                      <th className="px-4 py-2 text-left font-medium">审批意见</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#f0f1f3]">
                    {projects.map((project, index) => {
                      const projectCode = project.formTemplateId || project.id;
                      return (
                        <tr key={`summary-${project.id}`} className="hover:bg-[#f8f9fb] transition-colors">
                          <td className="px-4 py-2 text-center">{index + 1}</td>
                          <td className="px-4 py-2">{projectCode}</td>
                          <td className="px-4 py-2 text-[#1f2329] font-medium">{project.name}</td>
                          <td className="px-4 py-2">{project.initiator || "-"}</td>
                          <td className="px-4 py-2 max-w-[260px]"><div className="line-clamp-2">{project.problem || "-"}</div></td>
                          <td className="px-4 py-2 max-w-[260px]"><div className="line-clamp-2">{project.goal || "-"}</div></td>
                          <td className="px-4 py-2 max-w-[260px]"><div className="line-clamp-2">{project.actions || "-"}</div></td>
                          <td className="px-4 py-2">{project.resources || "-"}</td>
                          <td className="px-4 py-2">{project.cycle || "-"}</td>
                          <td className="px-4 py-2">{project.benefit || "-"}</td>
                          <td className="px-4 py-2">{project.approval || "-"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
}
