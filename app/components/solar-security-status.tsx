import { SolarPanel } from "@/app/components/solar-ui";

type SecurityStatus = {
  canRemoteControl: boolean;
  reasonCode: string | null;
  reason: string;
  telemetryFresh: boolean;
  controllerOnline: boolean;
  safetyControllerOk: boolean;
  emergencyStopClear: boolean;
  batteryPairConsistent: boolean;
  commandAuthenticationConfigured: boolean;
  localRemoteControlEnabled: boolean;
};

function value(ok: boolean, yes: string, no: string) {
  return <span className={ok ? "text-emerald-700 dark:text-emerald-300" : "font-bold text-red-700 dark:text-red-300"}>{ok ? yes : no}</span>;
}

export function SolarSecurityStatus({ status }: { status: SecurityStatus }) {
  return <SolarPanel title="Zabezpečení vzdáleného řízení" eyebrow="Security architecture">
    {!status.canRemoteControl ? <div className="solar-alert solar-alert--danger mt-4"><strong>REMOTE CONTROL LOCKED</strong><p className="mt-1">Důvod: {status.reasonCode ?? "UNKNOWN"} · {status.reason}</p></div> : <div className="solar-alert solar-alert--info mt-4"><strong>Remote control: ENABLED</strong><p className="mt-1">RPi může každý příkaz ještě odmítnout podle lokální safety policy.</p></div>}
    <dl className="solar-definition-list mt-4">
      <div><dt>RPi</dt><dd>{value(status.controllerOnline, "ONLINE", "OFFLINE / UNKNOWN")}</dd></div>
      <div><dt>Telemetrie</dt><dd>{value(status.telemetryFresh, "FRESH", "STALE / UNKNOWN")}</dd></div>
      <div><dt>Safety controller</dt><dd>{value(status.safetyControllerOk, "OK", "LOCKED")}</dd></div>
      <div><dt>Emergency stop</dt><dd>{value(status.emergencyStopClear, "CLEAR", "ACTIVE / UNKNOWN")}</dd></div>
      <div><dt>Battery pair</dt><dd>{value(status.batteryPairConsistent, "CONSISTENT", "MISMATCH / UNKNOWN")}</dd></div>
      <div><dt>Command authentication</dt><dd>{value(status.commandAuthenticationConfigured, "CONFIGURED", "NOT CONFIGURED")}</dd></div>
      <div><dt>Lokální kill switch</dt><dd>{value(status.localRemoteControlEnabled, "ENABLED", "DISABLED / UNKNOWN")}</dd></div>
      <div><dt>Fyzický kontakt</dt><dd>NEOVĚŘEN</dd></div>
    </dl>
  </SolarPanel>;
}
