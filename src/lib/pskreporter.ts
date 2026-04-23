export type PskBandOption = {
  value: string;
  label: string;
  range?: [number, number];
};

export const pskBandOptions: PskBandOption[] = [
  { value: "all", label: "Vsechna pasma" },
  { value: "160m", label: "160m", range: [1800000, 2000000] },
  { value: "80m", label: "80m", range: [3500000, 3800000] },
  { value: "60m", label: "60m", range: [5250000, 5450000] },
  { value: "40m", label: "40m", range: [7000000, 7300000] },
  { value: "30m", label: "30m", range: [10100000, 10150000] },
  { value: "20m", label: "20m", range: [14000000, 14350000] },
  { value: "17m", label: "17m", range: [18068000, 18168000] },
  { value: "15m", label: "15m", range: [21000000, 21450000] },
  { value: "12m", label: "12m", range: [24890000, 24990000] },
  { value: "10m", label: "10m", range: [28000000, 29700000] },
  { value: "6m", label: "6m", range: [50000000, 54000000] },
  { value: "2m", label: "2m", range: [144000000, 148000000] },
];

export const pskTimeOptions = [
  { value: 900, label: "15 minut" },
  { value: 3600, label: "1 hodina" },
  { value: 21600, label: "6 hodin" },
  { value: 43200, label: "12 hodin" },
  { value: 86400, label: "24 hodin" },
];

export function getBandRange(value: string) {
  const option = pskBandOptions.find((item) => item.value === value);
  return option?.range ?? null;
}

export function normalizePskCallsign(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9/]/g, "");
}

export function normalizePskTime(value: number) {
  if (!Number.isFinite(value)) {
    return 3600;
  }

  const min = 300;
  const max = 172800;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

