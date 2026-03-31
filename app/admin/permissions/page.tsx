"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Shield, Home, Users, Settings2, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { departments } from "@/lib/data";
import { Project, ProjectMemberRole, User, UserRole } from "@/types";

type SafeUser = Omit<User, "password">;
type ProjectSummary = Project & { taskCount?: number };

const roleLabels: Record<UserRole, string> = {
  admin: "公司管理员",
  manager: "部门负责人",
  employee: "普通员工",
};

const projectRoleLabels: Record<ProjectMemberRole, string> = {
  owner: "Owner",
  pm: "PM",
  member: "成员",
  viewer: "观察者",
};

export default function PermissionsPage() {
  const router = useRouter();
  const [me, setMe] = useState<SafeUser | null>(null);
  const [users, setUsers] = useState<SafeUser[]>([]);
  const [initialUserStateById, setInitialUserStateById] = useState<
    Record<string, Pick<SafeUser, "role" | "departmentId">>
  >({});
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [isSavingAllUsers, setIsSavingAllUsers] = useState(false);
  const [isSavingMembers, setIsSavingMembers] = useState(false);
  const [activeTab, setActiveTab] = useState<"users" | "projectMembers">("users");

  const [userQuery, setUserQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<UserRole | "all">("all");
  const [departmentFilter, setDepartmentFilter] = useState<string | "all">("all");
  const [userPage, setUserPage] = useState(1);

  const [isCreateUserOpen, setIsCreateUserOpen] = useState(false);
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [createUserError, setCreateUserError] = useState("");
  const [createForm, setCreateForm] = useState<{
    name: string;
    username: string;
    password: string;
    role: UserRole;
    departmentId: string;
    avatar: string;
  }>({
    name: "",
    username: "",
    password: "admin",
    role: "employee",
    departmentId: departments[0]?.id || "",
    avatar: "",
  });

  const [projectQuery, setProjectQuery] = useState("");
  const [memberQuery, setMemberQuery] = useState("");
  const [memberRoleFilter, setMemberRoleFilter] = useState<UserRole | "all">("all");
  const [memberDepartmentFilter, setMemberDepartmentFilter] = useState<string | "all">("all");
  const [projectMemberRoleFilter, setProjectMemberRoleFilter] = useState<
    ProjectMemberRole | "all"
  >("all");
  const [memberOnlySelected, setMemberOnlySelected] = useState(false);
  const [memberPage, setMemberPage] = useState(1);
  const [draftMemberRolesByProjectId, setDraftMemberRolesByProjectId] = useState<
    Record<string, Record<string, ProjectMemberRole>>
  >({});
  const [importUsernamesOpen, setImportUsernamesOpen] = useState(false);
  const [importUsernamesText, setImportUsernamesText] = useState("");
  const [importUsernamesMessage, setImportUsernamesMessage] = useState("");
  const [importProjectRole, setImportProjectRole] = useState<ProjectMemberRole>("member");
  const [syncDepartmentId, setSyncDepartmentId] = useState<string>(departments[0]?.id || "");
  const [syncDepartmentOpen, setSyncDepartmentOpen] = useState(false);
  const [syncDepartmentMessage, setSyncDepartmentMessage] = useState("");
  const [syncProjectRole, setSyncProjectRole] = useState<ProjectMemberRole>("member");
  const [bulkProjectRole, setBulkProjectRole] = useState<ProjectMemberRole>("member");

  useEffect(() => {
    let active = true;
    Promise.resolve()
      .then(() => {
        if (!active) return null;
        setIsLoading(true);
        setErrorMessage("");
        return fetch("/api/auth/me");
      })
      .then(async (meResponse) => {
        if (!meResponse || !active) return null;
        if (meResponse.status === 401) {
          router.replace("/login");
          return null;
        }
        if (!meResponse.ok) {
          setErrorMessage("加载用户信息失败");
          setIsLoading(false);
          return null;
        }
        const current = (await meResponse.json()) as SafeUser;
        if (!active) return null;
        if (current.role !== "admin") {
          setMe(current);
          setErrorMessage("当前账号无权限访问权限分配页面");
          setIsLoading(false);
          return null;
        }
        setMe(current);
        const [usersRes, projectsRes] = await Promise.all([
          fetch("/api/admin/users"),
          fetch("/api/projects"),
        ]);
        if (!active) return null;
        if (!usersRes.ok) {
          setErrorMessage("加载用户列表失败");
          setIsLoading(false);
          return null;
        }
        if (!projectsRes.ok) {
          setErrorMessage("加载项目列表失败");
          setIsLoading(false);
          return null;
        }
        const userData = (await usersRes.json()) as SafeUser[];
        const projectData = (await projectsRes.json()) as ProjectSummary[];
        setUsers(userData);
        setInitialUserStateById(
          Object.fromEntries(userData.map((u) => [u.id, { role: u.role, departmentId: u.departmentId }]))
        );
        setProjects(projectData);
        setSelectedProjectId(projectData[0]?.id || "");
        setIsLoading(false);
        return null;
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

  const allDepartments = useMemo(
    () => [{ id: "", name: "未指定" }, ...departments.map((d) => ({ id: d.id, name: d.name }))],
    []
  );

  const dirtyUserIds = useMemo(() => {
    return users
      .filter((u) => {
        const initial = initialUserStateById[u.id];
        if (!initial) return true;
        return initial.role !== u.role || (initial.departmentId || "") !== (u.departmentId || "");
      })
      .map((u) => u.id);
  }, [initialUserStateById, users]);

  const filteredUsers = useMemo(() => {
    const q = userQuery.trim().toLowerCase();
    return users.filter((u) => {
      if (roleFilter !== "all" && u.role !== roleFilter) return false;
      if (departmentFilter !== "all") {
        const dept = u.departmentId || "";
        if (dept !== departmentFilter) return false;
      }
      if (!q) return true;
      return (
        u.name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q)
      );
    });
  }, [departmentFilter, roleFilter, userQuery, users]);

  const userPageSize = 20;
  const userTotalPages = Math.max(1, Math.ceil(filteredUsers.length / userPageSize));
  const pagedUsers = useMemo(() => {
    const page = Math.min(userTotalPages, Math.max(1, userPage));
    const start = (page - 1) * userPageSize;
    return filteredUsers.slice(start, start + userPageSize);
  }, [filteredUsers, userPage, userTotalPages]);

  const setUserQueryAndReset = (v: string) => {
    setUserQuery(v);
    setUserPage(1);
  };
  const setRoleFilterAndReset = (v: UserRole | "all") => {
    setRoleFilter(v);
    setUserPage(1);
  };
  const setDepartmentFilterAndReset = (v: string | "all") => {
    setDepartmentFilter(v);
    setUserPage(1);
  };

  const updateUserRole = (userId: string, role: UserRole) => {
    setUsers((prev) =>
      prev.map((u) =>
        u.id === userId
          ? {
              ...u,
              role,
              departmentId: role === "admin" ? undefined : u.departmentId,
            }
          : u
      )
    );
  };

  const updateUserDepartment = (userId: string, departmentId: string) => {
    setUsers((prev) =>
      prev.map((u) => (u.id === userId ? { ...u, departmentId } : u))
    );
  };

  const saveUser = (userId: string) => {
    const user = users.find((u) => u.id === userId);
    if (!user) return;
    setSavingUserId(userId);
    setErrorMessage("");
    void (async () => {
      const response = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          role: user.role,
          departmentId: user.role === "admin" ? null : user.departmentId || null,
        }),
      });
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      if (response.status === 403) {
        setErrorMessage("无权限操作");
        return;
      }
      if (!response.ok) {
        setErrorMessage("保存用户权限失败");
        return;
      }
      const updated = (await response.json()) as SafeUser;
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      setInitialUserStateById((prev) => ({
        ...prev,
        [updated.id]: { role: updated.role, departmentId: updated.departmentId },
      }));
    })()
      .catch(() => {
        setErrorMessage("网络异常，保存失败");
      })
      .finally(() => {
        setSavingUserId(null);
      });
  };

  const saveAllUsers = () => {
    if (isSavingAllUsers) return;
    const ids = dirtyUserIds;
    if (ids.length === 0) return;
    setIsSavingAllUsers(true);
    setErrorMessage("");
    void (async () => {
      for (const userId of ids) {
        const user = users.find((u) => u.id === userId);
        if (!user) continue;
        const response = await fetch("/api/admin/users", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId,
            role: user.role,
            departmentId: user.role === "admin" ? null : user.departmentId || null,
          }),
        });
        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        if (response.status === 403) {
          setErrorMessage("无权限操作");
          return;
        }
        if (!response.ok) {
          setErrorMessage("保存用户权限失败");
          return;
        }
        const updated = (await response.json()) as SafeUser;
        setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
        setInitialUserStateById((prev) => ({
          ...prev,
          [updated.id]: { role: updated.role, departmentId: updated.departmentId },
        }));
      }
    })()
      .catch(() => {
        setErrorMessage("网络异常，保存失败");
      })
      .finally(() => {
        setIsSavingAllUsers(false);
      });
  };

  const openCreateUser = () => {
    setCreateUserError("");
    setCreateForm({
      name: "",
      username: "",
      password: "admin",
      role: "employee",
      departmentId: departments[0]?.id || "",
      avatar: "",
    });
    setIsCreateUserOpen(true);
  };

  const createUserSubmit = () => {
    if (isCreatingUser) return;
    setIsCreatingUser(true);
    setCreateUserError("");
    void (async () => {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: createForm.name,
          username: createForm.username,
          role: createForm.role,
          departmentId: createForm.role === "admin" ? null : createForm.departmentId || null,
          avatar: createForm.avatar || null,
          password: createForm.password,
        }),
      });
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      if (response.status === 403) {
        setCreateUserError("无权限操作");
        return;
      }
      if (response.status === 409) {
        setCreateUserError("用户名已存在");
        return;
      }
      if (!response.ok) {
        setCreateUserError("新增人员失败");
        return;
      }
      const created = (await response.json()) as SafeUser;
      setUsers((prev) => [created, ...prev]);
      setInitialUserStateById((prev) => ({
        ...prev,
        [created.id]: { role: created.role, departmentId: created.departmentId },
      }));
      setIsCreateUserOpen(false);
    })()
      .catch(() => {
        setCreateUserError("网络异常，新增失败");
      })
      .finally(() => {
        setIsCreatingUser(false);
      });
  };

  const filteredProjects = useMemo(() => {
    const q = projectQuery.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => p.name.toLowerCase().includes(q));
  }, [projectQuery, projects]);

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId) || null,
    [projects, selectedProjectId]
  );

  const buildDefaultMemberRoles = (project: ProjectSummary) => {
    const roles: Record<string, ProjectMemberRole> = {};
    for (const userId of project.memberIds || []) {
      roles[userId] = "member";
    }
    if (project.creatorId) roles[project.creatorId] = "owner";
    return roles;
  };

  const draftMemberRoles = useMemo(() => {
    if (!selectedProject) return {};
    return (
      draftMemberRolesByProjectId[selectedProject.id] ??
      selectedProject.memberRoles ??
      buildDefaultMemberRoles(selectedProject)
    );
  }, [draftMemberRolesByProjectId, selectedProject]);

  const draftMemberIds = useMemo(() => Object.keys(draftMemberRoles), [draftMemberRoles]);

  const isDraftDirty = useMemo(() => {
    if (!selectedProject) return false;
    const currentRoles = selectedProject.memberRoles ?? buildDefaultMemberRoles(selectedProject);
    const currentKeys = Object.keys(currentRoles);
    const draftKeys = Object.keys(draftMemberRoles);
    if (currentKeys.length !== draftKeys.length) return true;
    for (const key of draftKeys) {
      if (currentRoles[key] !== draftMemberRoles[key]) return true;
    }
    return false;
  }, [draftMemberRoles, selectedProject]);

  const filteredMemberUsers = useMemo(() => {
    if (!selectedProject) return [];
    const q = memberQuery.trim().toLowerCase();
    const selectedSet = new Set(Object.keys(draftMemberRoles));
    const creatorId = selectedProject.creatorId;
    return users.filter((u) => {
      if (memberRoleFilter !== "all" && u.role !== memberRoleFilter) return false;
      if (memberDepartmentFilter !== "all") {
        const dept = u.departmentId || "";
        if (dept !== memberDepartmentFilter) return false;
      }
      if (projectMemberRoleFilter !== "all") {
        const pr = draftMemberRoles[u.id];
        if (pr !== projectMemberRoleFilter) return false;
      }
      if (memberOnlySelected) {
        if (u.id !== creatorId && !selectedSet.has(u.id)) return false;
      }
      if (!q) return true;
      return u.name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q);
    });
  }, [draftMemberRoles, memberDepartmentFilter, memberOnlySelected, memberQuery, memberRoleFilter, projectMemberRoleFilter, selectedProject, users]);

  const memberPageSize = 24;
  const memberTotalPages = Math.max(1, Math.ceil(filteredMemberUsers.length / memberPageSize));
  const pagedMemberUsers = useMemo(() => {
    const page = Math.min(memberTotalPages, Math.max(1, memberPage));
    const start = (page - 1) * memberPageSize;
    return filteredMemberUsers.slice(start, start + memberPageSize);
  }, [filteredMemberUsers, memberPage, memberTotalPages]);

  const resetMemberPage = () => setMemberPage(1);

  const toggleMember = (userId: string) => {
    if (!selectedProject) return;
    if (userId === selectedProject.creatorId) return;
    setDraftMemberRolesByProjectId((prev) => {
      const base =
        prev[selectedProject.id] ??
        selectedProject.memberRoles ??
        buildDefaultMemberRoles(selectedProject);
      const next: Record<string, ProjectMemberRole> = { ...base };
      if (next[userId]) {
        delete next[userId];
      } else {
        next[userId] = "member";
      }
      next[selectedProject.creatorId] = "owner";
      return { ...prev, [selectedProject.id]: next };
    });
  };

  const selectAllFilteredMembers = () => {
    if (!selectedProject) return;
    const creatorId = selectedProject.creatorId;
    setDraftMemberRolesByProjectId((prev) => {
      const base =
        prev[selectedProject.id] ??
        selectedProject.memberRoles ??
        buildDefaultMemberRoles(selectedProject);
      const next: Record<string, ProjectMemberRole> = { ...base };
      for (const u of filteredMemberUsers) {
        if (!next[u.id]) next[u.id] = "member";
      }
      next[creatorId] = "owner";
      return { ...prev, [selectedProject.id]: next };
    });
  };

  const clearFilteredMembers = () => {
    if (!selectedProject) return;
    const creatorId = selectedProject.creatorId;
    if (!memberOnlySelected) {
      setDraftMemberRolesByProjectId((prev) => {
        const base =
          prev[selectedProject.id] ??
          selectedProject.memberRoles ??
          buildDefaultMemberRoles(selectedProject);
        const next: Record<string, ProjectMemberRole> = { ...base };
        for (const u of filteredMemberUsers) {
          if (u.id === creatorId) continue;
          delete next[u.id];
        }
        next[creatorId] = "owner";
        return { ...prev, [selectedProject.id]: next };
      });
      return;
    }
    setDraftMemberRolesByProjectId((prev) => ({
      ...prev,
      [selectedProject.id]: { [creatorId]: "owner" },
    }));
  };

  const setProjectMemberRole = (userId: string, role: ProjectMemberRole) => {
    if (!selectedProject) return;
    if (userId === selectedProject.creatorId) return;
    setDraftMemberRolesByProjectId((prev) => {
      const base =
        prev[selectedProject.id] ??
        selectedProject.memberRoles ??
        buildDefaultMemberRoles(selectedProject);
      const next: Record<string, ProjectMemberRole> = { ...base, [userId]: role };
      next[selectedProject.creatorId] = "owner";
      return { ...prev, [selectedProject.id]: next };
    });
  };

  const applyRoleToSelectedMembers = (role: ProjectMemberRole) => {
    if (!selectedProject) return;
    const creatorId = selectedProject.creatorId;
    setDraftMemberRolesByProjectId((prev) => {
      const base =
        prev[selectedProject.id] ??
        selectedProject.memberRoles ??
        buildDefaultMemberRoles(selectedProject);
      const next: Record<string, ProjectMemberRole> = { ...base };
      for (const userId of Object.keys(next)) {
        if (userId === creatorId) continue;
        next[userId] = role;
      }
      next[creatorId] = "owner";
      return { ...prev, [selectedProject.id]: next };
    });
  };

  const applyRoleToFilteredMembers = (role: ProjectMemberRole) => {
    if (!selectedProject) return;
    const creatorId = selectedProject.creatorId;
    setDraftMemberRolesByProjectId((prev) => {
      const base =
        prev[selectedProject.id] ??
        selectedProject.memberRoles ??
        buildDefaultMemberRoles(selectedProject);
      const next: Record<string, ProjectMemberRole> = { ...base };
      for (const u of filteredMemberUsers) {
        if (u.id === creatorId) continue;
        next[u.id] = role;
      }
      next[creatorId] = "owner";
      return { ...prev, [selectedProject.id]: next };
    });
  };

  const openImportUsernames = () => {
    setImportUsernamesMessage("");
    setImportUsernamesText("");
    setImportProjectRole("member");
    setImportUsernamesOpen(true);
  };

  const importUsernames = () => {
    if (!selectedProject) return;
    const creatorId = selectedProject.creatorId;
    const tokens = importUsernamesText
      .split(/[\s,，;；\n]+/g)
      .map((t) => t.trim())
      .filter(Boolean);
    const unique = Array.from(new Set(tokens.map((t) => t.toLowerCase())));
    if (unique.length === 0) {
      setImportUsernamesMessage("请输入用户名（可用换行/空格/逗号分隔）");
      return;
    }
    const userIdByUsername = new Map(users.map((u) => [u.username.toLowerCase(), u.id]));
    const foundIds: string[] = [];
    const notFound: string[] = [];
    for (const uname of unique) {
      const id = userIdByUsername.get(uname);
      if (!id) {
        notFound.push(uname);
        continue;
      }
      foundIds.push(id);
    }

    setDraftMemberRolesByProjectId((prev) => {
      const base =
        prev[selectedProject.id] ??
        selectedProject.memberRoles ??
        buildDefaultMemberRoles(selectedProject);
      const next: Record<string, ProjectMemberRole> = { ...base };
      for (const id of foundIds) {
        if (id === creatorId) continue;
        next[id] = importProjectRole;
      }
      next[creatorId] = "owner";
      return { ...prev, [selectedProject.id]: next };
    });

    const addedCount = foundIds.filter((id) => id !== creatorId).length;
    setImportUsernamesMessage(
      notFound.length > 0
        ? `已导入 ${addedCount} 人，未找到：${notFound.slice(0, 20).join("、")}${notFound.length > 20 ? "…" : ""}`
        : `已导入 ${addedCount} 人`
    );
  };

  const syncDepartmentMembers = () => {
    if (!selectedProject) return;
    const creatorId = selectedProject.creatorId;
    const deptUsers = users.filter((u) => (u.departmentId || "") === (syncDepartmentId || ""));
    if (deptUsers.length === 0) {
      setSyncDepartmentMessage("该部门暂无人员");
      return;
    }
    setDraftMemberRolesByProjectId((prev) => {
      const base =
        prev[selectedProject.id] ??
        selectedProject.memberRoles ??
        buildDefaultMemberRoles(selectedProject);
      const next: Record<string, ProjectMemberRole> = { ...base };
      for (const u of deptUsers) {
        if (u.id === creatorId) continue;
        next[u.id] = syncProjectRole;
      }
      next[creatorId] = "owner";
      return { ...prev, [selectedProject.id]: next };
    });
    setSyncDepartmentMessage(`已同步 ${deptUsers.filter((u) => u.id !== creatorId).length} 人`);
  };

  const saveMembers = (projectId: string, memberRoles: Record<string, ProjectMemberRole>) => {
    setIsSavingMembers(true);
    setErrorMessage("");
    void (async () => {
      const response = await fetch(`/api/projects/${projectId}/members`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          members: Object.entries(memberRoles).map(([userId, role]) => ({ userId, role })),
        }),
      });
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      if (response.status === 403) {
        setErrorMessage("无权限操作");
        return;
      }
      if (!response.ok) {
        setErrorMessage("保存项目成员失败");
        return;
      }
      const updated = (await response.json()) as Project;
      setProjects((prev) => prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)));
    })()
      .catch(() => {
        setErrorMessage("网络异常，保存失败");
      })
      .finally(() => {
        setIsSavingMembers(false);
        setDraftMemberRolesByProjectId((prev) => {
          const next = { ...prev };
          delete next[projectId];
          return next;
        });
      });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#f5f6f8] flex items-center justify-center text-[#8f959e]">
        正在加载...
      </div>
    );
  }

  if (!me) {
    return (
      <div className="min-h-screen bg-[#f5f6f8] flex items-center justify-center text-[#8f959e]">
        {errorMessage || "正在跳转登录..."}
      </div>
    );
  }

  if (me.role !== "admin") {
    return (
      <div className="min-h-screen bg-[#f5f6f8] flex items-center justify-center text-[#8f959e]">
        {errorMessage || "无权限"}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f5f6f8]">
      <header className="bg-white border-b border-[#e8eaed] shadow-[0_1px_3px_rgba(31,35,41,0.05)] sticky top-0 z-20">
        <div className="container mx-auto px-6 h-16 flex items-center">
          <div className="flex items-center gap-2">
            <div className="bg-[#3370ff] text-[white] p-1 rounded">
              <span className="font-bold text-lg">PM</span>
            </div>
            <span className="text-xl font-bold text-[#1f2329]">项目管理</span>
          </div>
          <div className="ml-auto flex items-center gap-4">
            <nav className="flex items-center gap-2">
              <Button
                variant="ghost"
                className="gap-2"
                onClick={() => router.push("/")}
              >
                <Home className="h-4 w-4" />
                首页
              </Button>
              <Button variant="ghost" className="gap-2 bg-[rgba(31,35,41,0.04)]">
                <Shield className="h-4 w-4" />
                权限分配
              </Button>
            </nav>
            <Button variant="ghost" onClick={() => router.back()}>
              返回
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        {errorMessage && (
          <div className="mb-6 rounded-lg px-4 py-3 text-sm" style={{ backgroundColor: '#f8f9fb', color: '#8f959e', border: '1px solid #e8eaed' }}>
            {errorMessage}
          </div>
        )}

        <div style={{ backgroundColor: '#f8f9fb' }}>
          <div className="px-6 py-4 border-b border-[#e8eaed] bg-[#f8f9fb] flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4" style={{ color: '#8f959e' }} />
              <h2 className="font-semibold text-[#1f2329]">权限分配</h2>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                className={activeTab === "users" ? "bg-[#f8f9fb] border border-[#e8eaed]" : ""}
                onClick={() => setActiveTab("users")}
              >
                用户与角色
              </Button>
              <Button
                variant="ghost"
                className={activeTab === "projectMembers" ? "bg-[#f8f9fb] border border-[#e8eaed]" : ""}
                onClick={() => setActiveTab("projectMembers")}
              >
                项目成员
              </Button>
            </div>
          </div>

          {activeTab === "users" ? (
            <div className="p-6 space-y-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 w-full">
                  <div>
                    <Label className="text-[#8f959e]">搜索用户</Label>
                    <div className="relative">
                      <Search className="h-4 w-4" style={{ color: '#8f959e' }} />
                      <Input
                        value={userQuery}
                        onChange={(e) => setUserQueryAndReset(e.target.value)}
                        placeholder="姓名 / 用户名"
                        className="pl-9"
                      />
                    </div>
                  </div>
                  <div>
                    <Label className="text-[#8f959e]">角色筛选</Label>
                    <select
                      className="h-10 w-full rounded-md border border-[#e8eaed] bg-[#f8f9fb] px-3 text-sm text-[#1f2329]"
                      value={roleFilter}
                      onChange={(e) => setRoleFilterAndReset(e.target.value as UserRole | "all")}
                    >
                      <option value="all">全部</option>
                      <option value="admin">{roleLabels.admin}</option>
                      <option value="manager">{roleLabels.manager}</option>
                      <option value="employee">{roleLabels.employee}</option>
                    </select>
                  </div>
                  <div>
                    <Label className="text-[#8f959e]">部门筛选</Label>
                    <select
                      className="h-10 w-full rounded-md border border-[#e8eaed] bg-[#f8f9fb] px-3 text-sm text-[#1f2329]"
                      value={departmentFilter}
                      onChange={(e) => setDepartmentFilterAndReset(e.target.value)}
                    >
                      <option value="all">全部</option>
                      {allDepartments.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="flex items-center gap-2 justify-end">
                  <Button variant="ghost" className="gap-2" onClick={openCreateUser}>
                    <Plus className="h-4 w-4" />
                    新增人员
                  </Button>
                  <Button
                    className="bg-[#3370ff] text-[white] hover:opacity-90"
                    disabled={dirtyUserIds.length === 0 || isSavingAllUsers}
                    onClick={saveAllUsers}
                  >
                    {isSavingAllUsers ? "保存中..." : `保存全部(${dirtyUserIds.length})`}
                  </Button>
                </div>
              </div>

              {isCreateUserOpen && (
                <div style={{ backgroundColor: '#f8f9fb', padding: '1rem' }}>
                  <div className="flex items-center justify-between gap-4">
                    <div className="font-medium text-[#1f2329]">新增人员</div>
                    <Button variant="ghost" onClick={() => setIsCreateUserOpen(false)}>
                      关闭
                    </Button>
                  </div>
                  {createUserError && (
                    <div className="mt-3 rounded-lg px-4 py-3 text-sm bg-red-50 text-red-600 border border-red-200">
                      {createUserError}
                    </div>
                  )}
                  <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <Label className="text-[#8f959e]">姓名</Label>
                      <Input
                        value={createForm.name}
                        onChange={(e) => setCreateForm((p) => ({ ...p, name: e.target.value }))}
                        placeholder="例如：张三"
                      />
                    </div>
                    <div>
                      <Label className="text-[#8f959e]">用户名</Label>
                      <Input
                        value={createForm.username}
                        onChange={(e) => setCreateForm((p) => ({ ...p, username: e.target.value }))}
                        placeholder="用于登录"
                      />
                    </div>
                    <div>
                      <Label className="text-[#8f959e]">密码</Label>
                      <Input
                        type="password"
                        value={createForm.password}
                        onChange={(e) => setCreateForm((p) => ({ ...p, password: e.target.value }))}
                        placeholder="默认：admin"
                      />
                    </div>
                    <div>
                      <Label className="text-[#8f959e]">角色</Label>
                      <select
                        className="h-10 w-full rounded-md border border-[#e8eaed] bg-[#f8f9fb] px-3 text-sm text-[#1f2329]"
                        value={createForm.role}
                        onChange={(e) =>
                          setCreateForm((p) => ({
                            ...p,
                            role: e.target.value as UserRole,
                          }))
                        }
                      >
                        <option value="admin">{roleLabels.admin}</option>
                        <option value="manager">{roleLabels.manager}</option>
                        <option value="employee">{roleLabels.employee}</option>
                      </select>
                    </div>
                    <div>
                      <Label className="text-[#8f959e]">部门</Label>
                      <select
                        className="h-10 w-full rounded-md border border-[#e8eaed] bg-[#f8f9fb] px-3 text-sm text-[#1f2329] disabled:bg-[#f8f9fb] disabled:text-[#8f959e]"
                        value={createForm.departmentId}
                        disabled={createForm.role === "admin"}
                        onChange={(e) => setCreateForm((p) => ({ ...p, departmentId: e.target.value }))}
                      >
                        {departments.map((dept) => (
                          <option key={dept.id} value={dept.id}>
                            {dept.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label className="text-[#8f959e]">头像URL(可选)</Label>
                      <Input
                        value={createForm.avatar}
                        onChange={(e) => setCreateForm((p) => ({ ...p, avatar: e.target.value }))}
                        placeholder="留空自动生成"
                      />
                    </div>
                  </div>
                  <div className="mt-4 flex justify-end gap-2">
                    <Button variant="ghost" onClick={() => setIsCreateUserOpen(false)}>
                      取消
                    </Button>
                    <Button
                      className="bg-[#3370ff] text-[white] hover:opacity-90"
                      disabled={isCreatingUser}
                      onClick={createUserSubmit}
                    >
                      {isCreatingUser ? "新增中..." : "确认新增"}
                    </Button>
                  </div>
                </div>
              )}

              <div className="overflow-auto rounded-xl border border-[#e8eaed]">
                <table className="w-full text-sm">
                  <thead className="bg-[#f8f9fb]">
                    <tr className="text-left text-[#8f959e]">
                      <th className="py-3 px-4">用户</th>
                      <th className="py-3 px-4">角色</th>
                      <th className="py-3 px-4">部门</th>
                      <th className="py-3 px-4">状态</th>
                      <th className="py-3 px-4">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#e8eaed] bg-[#f8f9fb]">
                    {pagedUsers.map((user) => {
                      const isDirty = dirtyUserIds.includes(user.id);
                      return (
                        <tr key={user.id} className="align-middle">
                          <td className="py-3 px-4">
                            <div className="font-medium text-[#1f2329]">{user.name}</div>
                            <div className="text-xs text-[#8f959e]">{user.username}</div>
                          </td>
                          <td className="py-3 px-4">
                            <select
                              className="h-9 w-full rounded-md border border-[#e8eaed] bg-[#f8f9fb] px-3 text-sm text-[#1f2329]"
                              value={user.role}
                              onChange={(e) => updateUserRole(user.id, e.target.value as UserRole)}
                            >
                              <option value="admin">{roleLabels.admin}</option>
                              <option value="manager">{roleLabels.manager}</option>
                              <option value="employee">{roleLabels.employee}</option>
                            </select>
                          </td>
                          <td className="py-3 px-4">
                            <select
                              className="h-9 w-full rounded-md border border-[#e8eaed] bg-[#f8f9fb] px-3 text-sm text-[#1f2329] disabled:bg-[#f8f9fb] disabled:text-[#8f959e]"
                              value={user.departmentId || ""}
                              disabled={user.role === "admin"}
                              onChange={(e) => updateUserDepartment(user.id, e.target.value)}
                            >
                              <option value="">未指定</option>
                              {departments.map((dept) => (
                                <option key={dept.id} value={dept.id}>
                                  {dept.name}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="py-3 px-4">
                            <span
                              className={
                                isDirty
                                  ? "text-xs rounded-full bg-[#f8f9fb] text-[#3370ff] border border-[#e8eaed] px-2 py-1"
                                  : "text-xs rounded-full bg-[#f8f9fb] text-[#34c724] border border-[#e8eaed] px-2 py-1"
                              }
                            >
                              {isDirty ? "未保存" : "已保存"}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <Button
                              size="sm"
                              className="bg-[#3370ff] text-[white] hover:opacity-90"
                              disabled={savingUserId === user.id || !isDirty}
                              onClick={() => saveUser(user.id)}
                            >
                              {savingUserId === user.id ? "保存中..." : "保存"}
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between text-sm text-[#8f959e]">
                <div>
                  共 {filteredUsers.length} 人，当前第 {Math.min(userTotalPages, Math.max(1, userPage))} / {userTotalPages} 页
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" disabled={userPage <= 1} onClick={() => setUserPage((p) => Math.max(1, p - 1))}>
                    上一页
                  </Button>
                  <Button variant="ghost" disabled={userPage >= userTotalPages} onClick={() => setUserPage((p) => Math.min(userTotalPages, p + 1))}>
                    下一页
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="rounded-xl border border-[#e8eaed] bg-[#f8f9fb] p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Settings2 className="h-4 w-4 text-[#8f959e]" />
                      <div className="font-medium text-[#1f2329]">选择项目</div>
                    </div>
                    <div className="text-sm text-[#8f959e]">
                      {selectedProject ? `已选成员 ${draftMemberIds.length} 人` : ""}
                    </div>
                  </div>
                  <div className="mt-3 space-y-3">
                    <div>
                      <Label className="text-[#8f959e]">搜索项目</Label>
                      <Input
                        value={projectQuery}
                        onChange={(e) => setProjectQuery(e.target.value)}
                        placeholder="输入项目名称"
                      />
                    </div>
                    <div>
                      <Label className="text-[#8f959e]">项目</Label>
                      <select
                        className="h-10 w-full rounded-md border border-[#e8eaed] bg-[#f8f9fb] px-3 text-sm text-[#1f2329]"
                        value={selectedProjectId}
                        onChange={(e) => {
                          setSelectedProjectId(e.target.value);
                          resetMemberPage();
                        }}
                      >
                        {filteredProjects.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm text-[#8f959e]">
                        {selectedProject ? (
                          <>
                            当前项目：<span className="font-medium text-[#1f2329]">{selectedProject.name}</span>
                            {isDraftDirty ? (
                              <span className="ml-2 text-[#3370ff]">（未保存）</span>
                            ) : (
                              <span className="ml-2 text-[#34c724]">（已保存）</span>
                            )}
                          </>
                        ) : (
                          "暂无项目"
                        )}
                      </div>
                      <Button
                        className="bg-[#3370ff] text-[white] hover:opacity-90"
                        disabled={!selectedProject || isSavingMembers || !isDraftDirty}
                        onClick={() => {
                          if (!selectedProject) return;
                          saveMembers(selectedProject.id, draftMemberRoles);
                        }}
                      >
                        {isSavingMembers ? "保存中..." : "保存成员"}
                      </Button>
                    </div>
                    <div className="text-xs text-[#8f959e]">创建者默认拥有权限，无法取消勾选</div>
                  </div>
                </div>

                <div className="rounded-xl border border-[#e8eaed] bg-[#f8f9fb] p-4">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-[#8f959e]" />
                    <div className="font-medium text-[#1f2329]">筛选人员</div>
                  </div>
                  <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <Label className="text-[#8f959e]">搜索人员</Label>
                      <Input
                        value={memberQuery}
                        onChange={(e) => {
                          setMemberQuery(e.target.value);
                          resetMemberPage();
                        }}
                        placeholder="姓名 / 用户名"
                      />
                    </div>
                    <div>
                      <Label className="text-[#8f959e]">仅看已选</Label>
                      <select
                        className="h-10 w-full rounded-md border border-[#e8eaed] bg-[#f8f9fb] px-3 text-sm text-[#1f2329]"
                        value={memberOnlySelected ? "1" : "0"}
                        onChange={(e) => {
                          setMemberOnlySelected(e.target.value === "1");
                          resetMemberPage();
                        }}
                      >
                        <option value="0">否</option>
                        <option value="1">是</option>
                      </select>
                    </div>
                    <div>
                      <Label className="text-[#8f959e]">角色</Label>
                      <select
                        className="h-10 w-full rounded-md border border-[#e8eaed] bg-[#f8f9fb] px-3 text-sm text-[#1f2329]"
                        value={memberRoleFilter}
                        onChange={(e) => {
                          setMemberRoleFilter(e.target.value as UserRole | "all");
                          resetMemberPage();
                        }}
                      >
                        <option value="all">全部</option>
                        <option value="admin">{roleLabels.admin}</option>
                        <option value="manager">{roleLabels.manager}</option>
                        <option value="employee">{roleLabels.employee}</option>
                      </select>
                    </div>
                    <div>
                      <Label className="text-[#8f959e]">项目角色</Label>
                      <select
                        className="h-10 w-full rounded-md border border-[#e8eaed] bg-[#f8f9fb] px-3 text-sm text-[#1f2329]"
                        value={projectMemberRoleFilter}
                        onChange={(e) => {
                          setProjectMemberRoleFilter(e.target.value as ProjectMemberRole | "all");
                          resetMemberPage();
                        }}
                      >
                        <option value="all">全部</option>
                        <option value="owner">{projectRoleLabels.owner}</option>
                        <option value="pm">{projectRoleLabels.pm}</option>
                        <option value="member">{projectRoleLabels.member}</option>
                        <option value="viewer">{projectRoleLabels.viewer}</option>
                      </select>
                    </div>
                    <div>
                      <Label className="text-[#8f959e]">部门</Label>
                      <select
                        className="h-10 w-full rounded-md border border-[#e8eaed] bg-[#f8f9fb] px-3 text-sm text-[#1f2329]"
                        value={memberDepartmentFilter}
                        onChange={(e) => {
                          setMemberDepartmentFilter(e.target.value);
                          resetMemberPage();
                        }}
                      >
                        <option value="all">全部</option>
                        {allDepartments.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="flex items-center gap-2">
                      <Label className="text-[#8f959e]">批量角色</Label>
                      <select
                        className="h-9 rounded-md border border-[#e8eaed] bg-[#f8f9fb] px-3 text-sm text-[#1f2329]"
                        value={bulkProjectRole}
                        onChange={(e) => setBulkProjectRole(e.target.value as ProjectMemberRole)}
                        disabled={!selectedProject}
                      >
                        <option value="pm">{projectRoleLabels.pm}</option>
                        <option value="member">{projectRoleLabels.member}</option>
                        <option value="viewer">{projectRoleLabels.viewer}</option>
                      </select>
                      <Button variant="ghost" disabled={!selectedProject} onClick={() => applyRoleToSelectedMembers(bulkProjectRole)}>
                        设为已选
                      </Button>
                      <Button variant="ghost" disabled={!selectedProject} onClick={() => applyRoleToFilteredMembers(bulkProjectRole)}>
                        设为当前筛选
                      </Button>
                    </div>
                    <Button variant="ghost" disabled={!selectedProject} onClick={selectAllFilteredMembers}>
                      全选当前筛选
                    </Button>
                    <Button variant="ghost" disabled={!selectedProject} onClick={clearFilteredMembers}>
                      取消当前筛选
                    </Button>
                    <div className="flex items-center gap-2 justify-end">
                      <Button
                        variant="ghost"
                        disabled={!selectedProject}
                        onClick={() => {
                          setSyncDepartmentMessage("");
                          setSyncDepartmentOpen((v) => !v);
                          setImportUsernamesOpen(false);
                        }}
                      >
                        按部门同步
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={!selectedProject}
                        onClick={() => {
                          setImportUsernamesOpen((v) => !v);
                          setSyncDepartmentOpen(false);
                          if (!importUsernamesOpen) openImportUsernames();
                        }}
                      >
                        批量导入
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              {importUsernamesOpen && selectedProject && (
                <div className="rounded-xl border border-[#e8eaed] bg-[#f8f9fb] p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="font-medium text-[#1f2329]">批量导入（按用户名）</div>
                    <Button variant="ghost" onClick={() => setImportUsernamesOpen(false)}>
                      关闭
                    </Button>
                  </div>
                  {importUsernamesMessage && (
                    <div className="mt-3 rounded-lg border border-[#e8eaed] bg-[#f8f9fb] px-4 py-3 text-sm text-[#1f2329]">
                      {importUsernamesMessage}
                    </div>
                  )}
                  <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="md:col-span-2">
                      <Label className="text-[#8f959e]">用户名列表</Label>
                      <textarea
                        className="mt-1 h-28 w-full resize-none rounded-md border border-[#e8eaed] bg-[#f8f9fb] px-3 py-2 text-sm text-[#1f2329]"
                        value={importUsernamesText}
                        onChange={(e) => setImportUsernamesText(e.target.value)}
                        placeholder={"示例：\nzhangsan\nlisi\nwangwu"}
                      />
                    </div>
                    <div>
                      <Label className="text-[#8f959e]">导入角色</Label>
                      <select
                        className="h-10 w-full rounded-md border border-[#e8eaed] bg-[#f8f9fb] px-3 text-sm text-[#1f2329]"
                        value={importProjectRole}
                        onChange={(e) => setImportProjectRole(e.target.value as ProjectMemberRole)}
                      >
                        <option value="pm">{projectRoleLabels.pm}</option>
                        <option value="member">{projectRoleLabels.member}</option>
                        <option value="viewer">{projectRoleLabels.viewer}</option>
                      </select>
                    </div>
                    <div className="flex items-end justify-end gap-2">
                      <Button variant="ghost" onClick={() => setImportUsernamesOpen(false)}>
                        取消
                      </Button>
                      <Button className="bg-[#3370ff] text-[white] hover:opacity-90" onClick={importUsernames}>
                        导入
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {syncDepartmentOpen && selectedProject && (
                <div className="rounded-xl border border-[#e8eaed] bg-[#f8f9fb] p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="font-medium text-[#1f2329]">按部门同步</div>
                    <Button variant="ghost" onClick={() => setSyncDepartmentOpen(false)}>
                      关闭
                    </Button>
                  </div>
                  {syncDepartmentMessage && (
                    <div className="mt-3 rounded-lg border border-[#e8eaed] bg-[#f8f9fb] px-4 py-3 text-sm text-[#1f2329]">
                      {syncDepartmentMessage}
                    </div>
                  )}
                  <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <Label className="text-[#8f959e]">部门</Label>
                      <select
                        className="h-10 w-full rounded-md border border-[#e8eaed] bg-[#f8f9fb] px-3 text-sm text-[#1f2329]"
                        value={syncDepartmentId}
                        onChange={(e) => setSyncDepartmentId(e.target.value)}
                      >
                        <option value="">未指定</option>
                        {departments.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label className="text-[#8f959e]">同步角色</Label>
                      <select
                        className="h-10 w-full rounded-md border border-[#e8eaed] bg-[#f8f9fb] px-3 text-sm text-[#1f2329]"
                        value={syncProjectRole}
                        onChange={(e) => setSyncProjectRole(e.target.value as ProjectMemberRole)}
                      >
                        <option value="pm">{projectRoleLabels.pm}</option>
                        <option value="member">{projectRoleLabels.member}</option>
                        <option value="viewer">{projectRoleLabels.viewer}</option>
                      </select>
                    </div>
                    <div className="flex items-end justify-end gap-2">
                      <Button variant="ghost" onClick={() => setSyncDepartmentOpen(false)}>
                        取消
                      </Button>
                      <Button className="bg-[#3370ff] text-[white] hover:opacity-90" onClick={syncDepartmentMembers}>
                        同步
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                {selectedProject ? (
                  pagedMemberUsers.map((user) => {
                    const isCreator = user.id === selectedProject.creatorId;
                    const currentRole = draftMemberRoles[user.id];
                    const checked = isCreator ? true : Boolean(currentRole);
                    return (
                      <label
                        key={user.id}
                        className="flex items-center justify-between gap-3 rounded-lg border border-[#e8eaed] bg-[#f8f9fb] px-3 py-2 hover:bg-[#f8f9fb]"
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-[#1f2329] truncate">{user.name}</div>
                          <div className="text-xs text-[#8f959e] truncate">
                            {user.username} · {roleLabels[user.role]}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {isCreator ? (
                            <div className="text-xs rounded-full bg-[#f8f9fb] text-[#1f2329] border border-[#e8eaed] px-2 py-1">
                              {projectRoleLabels.owner}
                            </div>
                          ) : (
                            <select
                              className="h-8 w-24 rounded-md border border-[#e8eaed] bg-[#f8f9fb] px-2 text-sm text-[#1f2329]"
                              value={currentRole || "member"}
                              onChange={(e) => setProjectMemberRole(user.id, e.target.value as ProjectMemberRole)}
                            >
                              <option value="pm">{projectRoleLabels.pm}</option>
                              <option value="member">{projectRoleLabels.member}</option>
                              <option value="viewer">{projectRoleLabels.viewer}</option>
                            </select>
                          )}
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={isCreator}
                            onChange={() => toggleMember(user.id)}
                            className="h-4 w-4 accent-[#3370ff] disabled:opacity-60"
                          />
                        </div>
                      </label>
                    );
                  })
                ) : (
                  <div className="text-sm text-[#8f959e]">暂无项目</div>
                )}
              </div>

              {selectedProject && (
                <div className="flex items-center justify-between text-sm text-[#8f959e]">
                  <div>
                    共 {filteredMemberUsers.length} 人，当前第 {Math.min(memberTotalPages, Math.max(1, memberPage))} / {memberTotalPages} 页
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" disabled={memberPage <= 1} onClick={() => setMemberPage((p) => Math.max(1, p - 1))}>
                      上一页
                    </Button>
                    <Button variant="ghost" disabled={memberPage >= memberTotalPages} onClick={() => setMemberPage((p) => Math.min(memberTotalPages, p + 1))}>
                      下一页
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
