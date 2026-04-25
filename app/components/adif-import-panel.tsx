"use client";

import { useState } from "react";

import { parseAdif } from "@/src/lib/adif";
import {
  getQsoFingerprint,
  getQsoKey,
  normalizeQsoRecord,
  qsoSelectFields,
  type QsoRecord,
} from "@/src/lib/qso-data";
import { ensureQslQueueForRecords } from "@/src/lib/qsl-data";
import { getSupabaseBrowserClient } from "@/src/lib/supabase";

type AdifImportPanelProps = {
  onImported: (records: QsoRecord[]) => void;
};

export function AdifImportPanel({ onImported }: AdifImportPanelProps) {
  const [adifText, setAdifText] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const parsedRecords = adifText ? parseAdif(adifText) : [];

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    const contents = await file.text();
    const records = parseAdif(contents);
    setAdifText(contents);
    setStatus(`Načten soubor ${file.name}. Připraveno k importu: ${records.length} záznamů.`);
  };

  const handleImport = async () => {
    const supabase = getSupabaseBrowserClient();

    if (!supabase) {
      setStatus("Supabase není připravený. Doplň platnou konfiguraci a zkus import znovu.");
      return;
    }

    if (!parsedRecords.length) {
      setStatus("V ADIF vstupu nebyl rozpoznán žádný záznam.");
      return;
    }

    setImporting(true);
    setStatus("Kontroluji duplicity a importuji ADIF do tabulky qso_logs...");

    const uniqueRecords: QsoRecord[] = [];
    const fileFingerprints = new Set<string>();

    for (const record of parsedRecords) {
      const fingerprint = getQsoFingerprint(record);

      if (fileFingerprints.has(fingerprint)) {
        continue;
      }

      fileFingerprints.add(fingerprint);
      uniqueRecords.push(record);
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setImporting(false);
      setStatus("Import je dostupný jen po přihlášení.");
      return;
    }

    const { data: existingRows, error: existingError } = await supabase
      .from("qso_logs")
      .select(qsoSelectFields)
      .eq("created_by", user.id);

    if (existingError) {
      setImporting(false);
      setStatus("Nepodařilo se načíst existující QSO z databáze pro kontrolu duplicit.");
      return;
    }

    const existingFingerprints = new Set(
      (existingRows ?? []).map((row) => getQsoFingerprint(normalizeQsoRecord(row))),
    );

    const recordsToInsert = uniqueRecords.filter((record) => !existingFingerprints.has(getQsoFingerprint(record)));
    const skippedDuplicates = parsedRecords.length - recordsToInsert.length;

    if (!recordsToInsert.length) {
      setImporting(false);
      setStatus(`Import nic nepřidal. Všech ${parsedRecords.length} záznamů už v databázi existuje nebo se v souboru opakovalo.`);
      return;
    }

    const payload = recordsToInsert.map((record) => ({
      callsign: record.callsign,
      band: record.band,
      mode: record.mode,
      date: record.date,
      time_on: record.timeOn || null,
      operator: record.operator || null,
      rst_sent: record.rstSent || null,
      rst_rcvd: record.rstRcvd || null,
      locator: record.locator,
      lat: record.lat,
      lon: record.lon,
      note: record.note ?? "",
      is_public: false,
    }));

    const { data, error } = await supabase.from("qso_logs").insert(payload).select(qsoSelectFields);

    setImporting(false);

    if (error) {
      if ("code" in error && error.code === "23505") {
        setStatus("Import byl zastaven databází, protože narazil na duplicitní QSO. Aktualizuj SQL schéma s unique indexem.");
        return;
      }

      setStatus(
        "Import selhal. V Supabase nejdřív vytvoř tabulku qso_logs podle přiloženého SQL schématu včetně sloupců time_on, operator, rst_sent, rst_rcvd a is_public.",
      );
      return;
    }

    const normalized = (data ?? []).map((row) => normalizeQsoRecord(row));

    let qslStatus = "";

    try {
      const qslResult = await ensureQslQueueForRecords({
        supabase,
        records: normalized,
        userId: user.id,
      });
      qslStatus = ` QSL fronta: přidáno ${qslResult.inserted}, už existovalo ${qslResult.skipped}.`;
    } catch {
      qslStatus = " QSL frontu se nepodařilo aktualizovat, zkontroluj SQL schéma qsl.sql.";
    }

    setAdifText("");
    setStatus(`Hotovo. Do databáze bylo vloženo ${normalized.length} záznamů, přeskočeno duplicit: ${skippedDuplicates}.${qslStatus}`);
    window.dispatchEvent(new CustomEvent("qso:changed", { detail: { count: normalized.length } }));
    onImported(normalized);
  };

  return (
    <div className="glass-panel rounded-[2rem] p-6 md:p-8">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-slate-500">ADIF import</p>
          <h2 className="mt-3 text-3xl font-semibold text-slate-950">Vložit ADIF do databáze</h2>
        </div>
        <label className="inline-flex cursor-pointer items-center justify-center rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800">
          Nahrát soubor
          <input type="file" accept=".adi,.adif,text/plain" className="hidden" onChange={handleFileChange} />
        </label>
      </div>

      <p className="mt-4 text-sm leading-6 text-slate-600">
        Import načítá i další ADIF pole: <code>RST_SENT</code>, <code>RST_RCVD</code>, <code>TIME_ON</code> a <code>OPERATOR</code>.
      </p>

      <div className="mt-6 grid gap-5 xl:grid-cols-[1.35fr_0.65fr]">
        <div className="space-y-4">
          <textarea
            value={adifText}
            onChange={(event) => setAdifText(event.target.value)}
            placeholder="<CALL:6>OK1ABC <BAND:3>20M <MODE:3>SSB <QSO_DATE:8>20260414 <TIME_ON:6>183200 <RST_SENT:2>59 <RST_RCVD:2>57 <OPERATOR:5>OK2MKJ <GRIDSQUARE:6>JO70VA <EOR>"
            className="min-h-72 w-full rounded-[1.6rem] border border-slate-900/10 bg-white/80 px-4 py-4 font-mono text-sm leading-6 text-slate-800 outline-none transition focus:border-sky-500/35"
          />

          {status ? (
            <p className="rounded-[1.2rem] border border-slate-900/8 bg-white px-4 py-3 text-sm leading-6 text-slate-700">
              {status}
            </p>
          ) : null}
        </div>

        <div className="flex h-full flex-col gap-4">
          <div className="rounded-[1.6rem] border border-slate-900/10 bg-slate-100/80 p-4">
            <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Souhrn importu</p>
            <p className="mt-3 text-3xl font-semibold text-slate-950">{parsedRecords.length}</p>
            <p className="mt-1 text-sm text-slate-600">rozpoznaných záznamů</p>
          </div>

          <div className="flex-1 rounded-[1.6rem] border border-slate-900/10 bg-white/80 p-4">
            <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Náhled QSO</p>
            {parsedRecords.length ? (
              <div className="mt-4 space-y-3">
                {parsedRecords.slice(0, 4).map((record, index) => (
                  <div key={getQsoKey(record, index)} className="rounded-[1.1rem] border border-slate-900/8 bg-slate-50/90 px-3 py-3">
                    <p className="font-semibold text-slate-950">{record.callsign}</p>
                    <p className="mt-1 text-sm text-slate-600">
                      {record.date} / {record.band} / {record.mode}
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                      {record.rstSent || "--"} / {record.rstRcvd || "--"} / {record.locator || "bez lokátoru"}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-4 text-sm leading-6 text-slate-600">Po vložení ADIF se tady ukáže rychlý náhled prvních spojení.</p>
            )}
          </div>

          <button
            onClick={handleImport}
            disabled={importing || !parsedRecords.length}
            className="rounded-full bg-slate-950 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {importing ? "Importuji..." : "Importovat do qso_logs"}
          </button>
        </div>
      </div>
    </div>
  );
}
