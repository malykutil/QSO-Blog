import type { Metadata } from "next";

import { AppShell } from "@/app/components/app-shell";
import { QslManager } from "@/app/components/qsl-manager";

export const metadata: Metadata = {
  title: "QSL lístky",
  description: "Náhled, správa a odesílání digitálních QSL lístků stanice OK2MKJ.",
};

export default function QslPage() {
  return (
    <AppShell>
      <QslManager />
    </AppShell>
  );
}
