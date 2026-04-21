import { AppShell } from "@/app/components/app-shell";
import { QsoMapClient } from "@/app/components/qso-map-client";

export default function MapaPage() {
  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-[96rem] flex-col gap-6">
        <QsoMapClient mode="public" layout="wide" />
      </div>
    </AppShell>
  );
}
