import type { Metadata } from "next";

import { AppShell } from "@/app/components/app-shell";
import { TradingDashboard } from "@/app/components/trading-dashboard";

export const metadata: Metadata = {
  title: "AI Trading",
  robots: { index: false, follow: false },
};

export default function TradingPage() {
  return (
    <AppShell>
      <TradingDashboard />
    </AppShell>
  );
}
