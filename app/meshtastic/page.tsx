import { AppShell } from "@/app/components/app-shell";
import { MeshtasticPanel } from "@/app/components/meshtastic-panel";

export default function MeshtasticPage() {
  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-[96rem] flex-col gap-6">
        <MeshtasticPanel />
      </div>
    </AppShell>
  );
}
