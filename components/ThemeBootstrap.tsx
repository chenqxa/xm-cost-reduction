"use client";

import { useEffect } from "react";

const validThemes = ["graphite", "ocean", "amber"] as const;

const applyTheme = (theme: string) => {
  if (typeof document === "undefined") return;
  if (!validThemes.includes(theme as (typeof validThemes)[number])) return;
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem("xm-theme", theme);
  } catch {}
};

export function ThemeBootstrap() {
  useEffect(() => {
    try {
      const stored = localStorage.getItem("xm-theme");
      if (stored) applyTheme(stored);
    } catch {}

    void (async () => {
      try {
        const response = await fetch("/api/settings", { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as { theme?: string };
        if (data?.theme) applyTheme(data.theme);
      } catch {}
    })();
  }, []);

  return null;
}

