"use client";

import { readThemeMode, saveThemeMode } from "@/src/lib/theme";

export function ThemeToggle() {
  const handleToggle = () => {
    const currentTheme = readThemeMode();
    saveThemeMode(currentTheme === "dark" ? "light" : "dark");
  };

  return (
    <div className="rounded-[1.5rem] border border-slate-900/8 bg-white/80 px-4 py-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">Vzhled webu</p>
          <p className="mt-1 text-sm font-medium text-slate-900">Tmavý režim</p>
        </div>

        <button
          type="button"
          onClick={handleToggle}
          className="theme-toggle-switch relative inline-flex h-9 w-[4.5rem] items-center rounded-full border px-1 transition"
        >
          <span className="theme-toggle-switch__thumb h-7 w-7 rounded-full shadow-[0_8px_16px_rgba(15,23,42,0.18)] transition" />
        </button>
      </div>
    </div>
  );
}
