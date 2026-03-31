"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { User } from "@/types";
import Image from "next/image";
import {
  Home, FolderPlus, Plus, Shield, ListTodo, Building2, FileSpreadsheet,
  LogOut, Settings, ChevronRight,
} from "lucide-react";

interface AppLayoutProps {
  currentUser: User;
  children: React.ReactNode;
  hideSidebar?: boolean;
}

const sidebarNav = [
  { section: "核心", items: [
    { label: "工作台", icon: Home, href: "/" },
    { label: "项目管理", icon: FolderPlus, href: "/projects" },
    { label: "BOM核价", icon: FileSpreadsheet, href: "/pricing" },
  ]},
  { section: "操作", items: [
    { label: "新建项目", icon: Plus, href: "/projects/new" },
    { label: "项目审批", icon: Shield, disabled: true },
    { label: "报表分析", icon: ListTodo, disabled: true },
    { label: "项目模板", icon: Building2, disabled: true },
  ]},
];

export default function AppLayout({ currentUser, children, hideSidebar }: AppLayoutProps) {
  const router = useRouter();
  const pathname = usePathname();
  const avatarRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  useEffect(() => {
    if (!userMenuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node) || avatarRef.current?.contains(e.target as Node)) return;
      setUserMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setUserMenuOpen(false); };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [userMenuOpen]);

  const handleLogout = () => {
    void (async () => {
      await fetch("/api/auth/logout", { method: "POST" });
      router.replace("/login");
    })();
  };

  const roleLabel = currentUser.role === "admin" ? "管理员" : currentUser.role === "manager" ? "部门经理" : "成员";

  return (
    <div className="min-h-screen bg-[radial-gradient(1400px_circle_at_0%_0%,#ffffff_0%,#f5f7fb_35%,#eef3ff_100%)]">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 border-b border-white/70 bg-white/70 backdrop-blur-xl shadow-[0_6px_24px_rgba(31,35,41,0.06)]" style={{ height: 56 }}>
        <div className="h-full mx-auto max-w-screen-2xl px-5 flex items-center">
          {/* Logo */}
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-[#3370ff] via-[#3e63ff] to-[#245bdb] flex items-center justify-center shadow-[0_6px_16px_rgba(51,112,255,0.35)]">
              <span className="text-xs font-bold text-white">PM</span>
            </div>
            <span className="text-[15px] font-semibold text-[#1f2329] hidden sm:block tracking-tight">降本项目管理</span>
          </div>

          {/* Nav */}
          <nav className="hidden md:flex items-center gap-0.5 ml-8">
            {[
              { label: "工作台", icon: Home, href: "/", match: (p: string) => p === "/" },
              { label: "项目", icon: FolderPlus, href: "/projects", match: (p: string) => p.startsWith("/project") },
              { label: "核价", icon: FileSpreadsheet, href: "/pricing", match: (p: string) => p === "/pricing" },
            ].map((nav) => {
              const Icon = nav.icon;
              const active = nav.match(pathname);
              return (
                <button key={nav.href} type="button" onClick={() => router.push(nav.href)}
                  className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-[13px] font-medium transition-all ${
                    active ? "bg-[#eaf0ff] text-[#2f5de0] shadow-[inset_0_0_0_1px_rgba(51,112,255,0.18)]" : "text-[#646a73] hover:text-[#1f2329] hover:bg-white/75"
                  }`}>
                  <Icon className="h-3.5 w-3.5" /> {nav.label}
                </button>
              );
            })}
            {currentUser.role === "admin" && (
              <button type="button" onClick={() => router.push("/admin/permissions")}
                className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-[13px] font-medium transition-all ${
                  pathname.startsWith("/admin") ? "bg-[#eaf0ff] text-[#2f5de0] shadow-[inset_0_0_0_1px_rgba(51,112,255,0.18)]" : "text-[#646a73] hover:text-[#1f2329] hover:bg-white/75"
                }`}>
                <Shield className="h-3.5 w-3.5" /> 权限
              </button>
            )}
          </nav>

          <div className="ml-auto flex items-center gap-2.5">
            {["admin", "manager"].includes(currentUser.role) && (
              <Button size="sm" className="h-8 px-3.5 gap-1.5 rounded-xl text-xs font-medium bg-gradient-to-r from-[#3370ff] to-[#245bdb] hover:brightness-105 shadow-[0_6px_16px_rgba(51,112,255,0.28)]" onClick={() => router.push("/projects/new")}>
                <Plus className="h-3.5 w-3.5" /> 新建项目
              </Button>
            )}

            {/* Avatar + dropdown */}
            <div className="relative">
              <button ref={avatarRef} type="button" onClick={() => setUserMenuOpen((v) => !v)}
                className="h-8 w-8 rounded-full bg-[#f0f1f3] flex items-center justify-center overflow-hidden border border-white shadow-sm hover:ring-2 hover:ring-[#3370ff]/25 transition-all">
                <Image src={currentUser.avatar} alt={currentUser.name} width={32} height={32} unoptimized className="h-full w-full object-cover" />
              </button>

              {userMenuOpen && (
                <div ref={menuRef}
                  className="absolute right-0 top-[calc(100%+8px)] w-56 rounded-2xl border border-[#e8eaed] bg-white/95 backdrop-blur-md shadow-[0_16px_36px_rgba(31,35,41,0.12)] overflow-hidden z-50">
                  <div className="px-4 py-3 border-b border-[#f0f1f3] bg-[#f8f9fb]">
                    <div className="flex items-center gap-2.5">
                      <div className="h-9 w-9 rounded-full overflow-hidden border border-[#e8eaed] shrink-0">
                        <Image src={currentUser.avatar} alt={currentUser.name} width={36} height={36} unoptimized className="h-full w-full object-cover" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-[#1f2329] truncate">{currentUser.name}</div>
                        <div className="text-xs text-[#8f959e]">{roleLabel}</div>
                      </div>
                    </div>
                  </div>
                  <div className="py-1">
                    <button type="button" className="w-full px-4 py-2 text-left text-sm text-[#1f2329] hover:bg-[#f0f1f3] flex items-center gap-2.5 transition-colors"
                      onClick={() => { setUserMenuOpen(false); router.push("/admin/settings"); }}>
                      <Settings className="h-4 w-4 text-[#8f959e]" /> 系统设置
                    </button>
                    <button type="button" className="w-full px-4 py-2 text-left text-sm text-red-500 hover:bg-red-50 flex items-center gap-2.5 transition-colors"
                      onClick={handleLogout}>
                      <LogOut className="h-4 w-4" /> 退出登录
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Body */}
      <div className="pt-[56px]">
        <div className="mx-auto max-w-screen-2xl flex">
          {/* Sidebar */}
          {!hideSidebar && (
            <aside className="hidden lg:block w-56 shrink-0 min-h-[calc(100vh-56px)] sticky top-[56px] p-3">
              <div className="h-full rounded-2xl border border-[#e6ebf5] bg-white/80 backdrop-blur-sm shadow-[0_12px_28px_rgba(31,35,41,0.06)] p-3 space-y-4">
                {sidebarNav.map((group) => (
                  <div key={group.section}>
                    <div className="px-3 py-1 text-[11px] font-semibold text-[#8f959e] uppercase tracking-wider">{group.section}</div>
                    <div className="mt-0.5 space-y-0.5">
                      {group.items.map((item) => {
                        const Icon = item.icon;
                        const isActive = pathname === item.href;
                        return (
                          <button
                            key={item.label}
                            type="button"
                            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-[13px] font-medium transition-all ${
                              isActive
                                ? "bg-[#eaf0ff] text-[#2f5de0] shadow-[inset_0_0_0_1px_rgba(51,112,255,0.18)]"
                                : "text-[#646a73] hover:text-[#1f2329] hover:bg-[#f5f7fb]"
                            } ${item.disabled ? "opacity-40 cursor-not-allowed" : ""}`}
                            onClick={() => {
                              if (item.disabled || !item.href) return;
                              router.push(item.href);
                            }}
                            disabled={item.disabled}
                          >
                            <Icon className="h-4 w-4 shrink-0" />
                            <span className="truncate flex-1 text-left">{item.label}</span>
                            {isActive && <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-50" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </aside>
          )}

          {/* Main content */}
          <main className="min-w-0 flex-1 p-5 pb-12">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
