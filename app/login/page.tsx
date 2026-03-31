"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Lock, User, ArrowRight, Shield } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/auth/me");
        if (response.ok) {
          router.replace("/");
        }
      } catch { /* ignore */ }
    })();
  }, [router]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!username || !password) {
      setErrorMessage("请输入用户名和密码");
      return;
    }
    void (async () => {
      setIsSubmitting(true);
      setErrorMessage("");
      try {
        const response = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password }),
        });
        if (!response.ok) {
          const data = (await response.json()) as { message?: string };
          setErrorMessage(data.message || "登录失败");
          setIsSubmitting(false);
          return;
        }
        router.replace("/");
      } catch {
        setErrorMessage("网络异常，请重试");
        setIsSubmitting(false);
      }
    })();
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4"
      style={{ background: "linear-gradient(135deg, #f0f4ff 0%, #f5f6f8 40%, #eef9f5 100%)" }}>
      {/* Decorative shapes */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full opacity-[0.07]"
          style={{ background: "radial-gradient(circle, #3370ff, transparent 70%)" }} />
        <div className="absolute -bottom-32 -left-32 w-[500px] h-[500px] rounded-full opacity-[0.05]"
          style={{ background: "radial-gradient(circle, #34c724, transparent 70%)" }} />
      </div>

      <div className="relative w-full max-w-[420px]">
        {/* Brand header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-[#3370ff] shadow-lg shadow-blue-500/20 mb-4">
            <Shield className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-[#1f2329] tracking-tight">降本项目管理</h1>
          <p className="text-sm text-[#8f959e] mt-1.5">企业级降本增效协作平台</p>
        </div>

        {/* Login card */}
        <div className="bg-white rounded-2xl shadow-[0_8px_40px_rgba(31,35,41,0.08)] border border-[#e8eaed]/60 p-8">
          {errorMessage && (
            <div className="mb-5 flex items-center gap-2 rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-600">
              <svg className="h-4 w-4 shrink-0" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm-.75 4.75a.75.75 0 011.5 0v3a.75.75 0 01-1.5 0v-3zm.75 5.75a.75.75 0 100-1.5.75.75 0 000 1.5z"/></svg>
              {errorMessage}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="username" className="text-[13px] font-medium text-[#1f2329]">用户名</Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#8f959e]" />
                <Input
                  id="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="请输入用户名"
                  className="pl-10 h-11 rounded-xl border-[#e8eaed] bg-[#f8f9fb] focus:bg-white focus:border-[#3370ff] focus:ring-2 focus:ring-[rgba(51,112,255,0.12)]"
                  autoComplete="username"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-[13px] font-medium text-[#1f2329]">密码</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#8f959e]" />
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="请输入密码"
                  className="pl-10 h-11 rounded-xl border-[#e8eaed] bg-[#f8f9fb] focus:bg-white focus:border-[#3370ff] focus:ring-2 focus:ring-[rgba(51,112,255,0.12)]"
                  autoComplete="current-password"
                />
              </div>
            </div>

            <Button type="submit" className="w-full h-11 rounded-xl text-[15px] font-semibold bg-[#3370ff] hover:bg-[#245bdb] shadow-lg shadow-blue-500/20 transition-all duration-200 hover:shadow-blue-500/30 active:scale-[0.98]" disabled={isSubmitting}>
              {isSubmitting ? (
                <span className="flex items-center gap-2">
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-25"/><path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/></svg>
                  登录中...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  登录 <ArrowRight className="h-4 w-4" />
                </span>
              )}
            </Button>
          </form>

          <div className="mt-6 pt-5 border-t border-[#e8eaed]">
            <div className="flex items-center justify-center gap-4 text-xs text-[#8f959e]">
              <span className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                系统正常运行
              </span>
              <span>·</span>
              <span>V1.0</span>
            </div>
          </div>
        </div>

        {/* Footer hint */}
        <div className="text-center mt-6 text-xs text-[#8f959e]/70">
          默认管理员：administrator / admin
        </div>
      </div>
    </div>
  );
}
