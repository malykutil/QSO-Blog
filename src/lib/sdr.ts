export const SDR_RECEIVER_URL = process.env.NEXT_PUBLIC_SDR_RECEIVER_URL ?? "https://ft-891.taild81c91.ts.net";
export const SDR_CONTROLLER_URL = process.env.SDR_CONTROLLER_URL ?? `${SDR_RECEIVER_URL}/control`;

export type SdrStatus = {
  active: boolean;
  ready: boolean;
  available: boolean;
  canControl: boolean;
  deviceConnected: boolean;
  idleTimeoutSeconds: number;
  secondsRemaining: number;
  receiverUrl: string;
  error?: string;
};
