"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Home, Shield, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Label } from "@/components/ui/Label";
import { AppSettings, ThemeOption, User } from "@/types";

type SafeUser = Omit<User, "password">;

const themeOptions: { value: ThemeOption; label: string; description: string }[] = [
  { value: "graphite", label: "Graphite 极简", description: "冷灰专业、轻质感" },
  { value: "ocean", label: "Ocean 工业蓝", description: "蓝灰主调、理性克制" },
  { value: "amber", label: "Amber 暖灰", description: "暖灰琥珀、稳重友好" },
];

const buildFallbackSettings = (): AppSettings => ({ theme: "graphite", forms: { source: "local" } });

export default function AdminSettingsPage() {
  const router = useRouter();
  const [me, setMe] = useState<SafeUser | null>(null);
  const [settings, setSettings] = useState<AppSettings>(buildFallbackSettings);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const canAccess = useMemo(() => me?.role === "admin", [me]);
  const activeTheme = settings.theme;

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
        const current = (await meResponse.json()) as SafeUser;
        if (!active) return;
        setMe(current);
        if (current.role !== "admin") {
          setErrorMessage("当前账号无权限访问系统设置");
          setIsLoading(false);
          return;
        }
        const settingsResponse = await fetch("/api/admin/settings", { cache: "no-store" });
        if (!active) return;
        if (settingsResponse.status === 401) {
          router.replace("/login");
          return;
        }
        if (settingsResponse.status === 403) {
          setErrorMessage("无权限访问系统设置");
          setIsLoading(false);
          return;
        }
        if (!settingsResponse.ok) {
          setErrorMessage("加载系统设置失败");
          setIsLoading(false);
          return;
        }
        const data = (await settingsResponse.json()) as AppSettings;
        if (!active) return;
        setSettings(data && typeof data === "object" ? data : buildFallbackSettings());
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

  const updateTheme = (theme: ThemeOption) => {
    setSettings((prev) => ({ ...prev, theme }));
  };

  const handleSave = () => {
    if (isSaving) return;
    setIsSaving(true);
    setErrorMessage("");
    setSuccessMessage("");
    void (async () => {
      const response = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme: settings.theme }),
      });
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      if (response.status === 403) {
        setErrorMessage("无权限保存");
        return;
      }
      if (!response.ok) {
        setErrorMessage("保存失败");
        return;
      }
      const updated = (await response.json()) as AppSettings;
      setSettings(updated);
      setSuccessMessage("已保存");
    })()
      .catch(() => {
        setErrorMessage("网络异常，保存失败");
      })
      .finally(() => {
        setIsSaving(false);
        setTimeout(() => setSuccessMessage(""), 1500);
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

  if (!canAccess) {
    return (
      <div className="min-h-screen bg-[#f5f6f8] flex items-center justify-center text-[#8f959e]">
        {errorMessage || "无权限"}
      </div>
    );
  }

  const themeMeta = themeOptions.find((o) => o.value === activeTheme);

  return (
    <div className="min-h-screen bg-[#f5f6f8] pb-12">
      <header className="bg-white border-b border-[#e8eaed] shadow-[0_1px_3px_rgba(31,35,41,0.05)] sticky top-0 z-20">
        <div className="container mx-auto px-6 h-16 flex items-center">
          <div className="flex items-center gap-2">
            <div className="bg-[#3370ff] text-white p-1 rounded">
              <span className="font-bold text-lg">PM</span>
            </div>
            <span className="text-xl font-bold text-[#1f2329]">项目管理</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" className="gap-2" onClick={() => router.push("/")}>
              <Home className="h-4 w-4" />
              首页
            </Button>
            <Button variant="ghost" className="gap-2" onClick={() => router.push("/admin/permissions")}>
              <Shield className="h-4 w-4" />
              权限分配
            </Button>
            <Button variant="ghost" className="gap-2 bg-[rgba(31,35,41,0.04)]">
              <Settings2 className="h-4 w-4" />
              系统设置
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8 space-y-6">
        <div className="bg-white rounded-xl border border-[#e8eaed] p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-lg font-semibold text-[#1f2329]">视觉主题</div>
              <div className="mt-1 text-sm text-[#8f959e]">{themeMeta?.description}</div>
            </div>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? "保存中..." : "保存"}
            </Button>
          </div>

          {errorMessage && (
            <div className="mt-4 rounded-lg px-4 py-3 text-sm bg-red-50 text-red-600 border border-red-200">
              {errorMessage}
            </div>
          )}
          {successMessage && (
            <div className="mt-4 rounded-lg px-4 py-3 text-sm bg-emerald-50 text-emerald-600 border border-emerald-200">
              {successMessage}
            </div>
          )}

          <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>主题选择</Label>
              <select
                className="h-10 w-full rounded-lg border border-[#e8eaed] bg-[#f8f9fb] px-3 text-sm text-[#1f2329]"
                value={activeTheme}
                onChange={(e) => updateTheme(e.target.value as ThemeOption)}
              >
                {themeOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

      </main>
    </div>
  );
}
