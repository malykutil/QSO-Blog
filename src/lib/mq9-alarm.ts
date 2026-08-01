export const MQ9_ALARM_RESET_MARKER = -1;

export function isMq9AlarmResetMarker(
  alarm: boolean | null | undefined,
  triggerRaw: number | null | undefined,
) {
  return alarm === false && triggerRaw === MQ9_ALARM_RESET_MARKER;
}
