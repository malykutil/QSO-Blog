import { formatBand, resolveCoordinatesForQso, type QsoRecord } from "@/src/lib/qso-data";

type AdifFieldMap = Record<string, string>;

function parseAdifFields(recordText: string) {
  const values: AdifFieldMap = {};
  const tagPattern = /<([a-z0-9_]+):(\d+)(?::[^>]*)?>/gi;
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(recordText)) !== null) {
    const key = match[1].toLowerCase();
    const length = Number(match[2]);
    const valueStart = tagPattern.lastIndex;
    const value = recordText.slice(valueStart, valueStart + length);
    values[key] = value.trim();
    tagPattern.lastIndex = valueStart + length;
  }

  return values;
}

function normalizeDate(value: string | undefined) {
  if (!value || value.length < 8) {
    return "";
  }

  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function normalizeTime(value: string | undefined) {
  if (!value || value.length < 4) {
    return "";
  }

  const padded = value.padEnd(6, "0");
  return `${padded.slice(0, 2)}:${padded.slice(2, 4)}:${padded.slice(4, 6)}`;
}

export function parseAdif(text: string): QsoRecord[] {
  const records = text.split(/<eor>/i);

  return records.reduce<QsoRecord[]>((accumulator, recordText, index) => {
    const fields = parseAdifFields(recordText);
    const locator =
      fields.gridsquare ||
      fields.vucc_grids ||
      fields.my_gridsquare ||
      fields.locator ||
      "";
    const callsign = (fields.call || "").toUpperCase();
    const coordinates = resolveCoordinatesForQso({ locator, callsign });
    const date = normalizeDate(fields.qso_date);
    const timeOn = normalizeTime(fields.time_on);
    const band = formatBand(fields.band);
    const mode = (fields.mode || "").toUpperCase();

    if (!callsign || !date || !band || !mode) {
      return accumulator;
    }

    accumulator.push({
      id: `adif-${index}-${callsign}`,
      callsign,
      band,
      mode,
      date,
      timeOn,
      operator: fields.operator || fields.station_callsign || "",
      rstSent: fields.rst_sent || "",
      rstRcvd: fields.rst_rcvd || "",
      locator,
      lat: coordinates.lat,
      lon: coordinates.lon,
      note: fields.comment || fields.name || "",
      isPublic: false,
    });

    return accumulator;
  }, []);
}
