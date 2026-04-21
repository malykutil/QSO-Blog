import type { ReactNode } from "react";

import { Sidebar } from "@/app/components/sidebar";

export function AppShell({
  children,
  contentClassName = "",
}: {
  children: ReactNode;
  contentClassName?: string;
}) {
  return (
    <div className="min-h-screen bg-transparent text-slate-950">
      <div className="relative min-h-screen overflow-hidden lg:grid lg:grid-cols-[22rem_minmax(0,1fr)]">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(56,132,216,0.16),_transparent_30%),radial-gradient(circle_at_bottom_right,_rgba(255,146,94,0.16),_transparent_24%)]" />
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-slate-400/30 to-transparent" />
        </div>
        <Sidebar />
        <main className={`relative px-4 py-4 lg:px-7 lg:py-7 ${contentClassName}`}>{children}</main>
      </div>
    </div>
  );
}
