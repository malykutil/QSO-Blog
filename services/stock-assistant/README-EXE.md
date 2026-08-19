# AI Stock PAPER Assistant – Windows EXE

`AIStockPaperAssistant.exe` je přenosná Windows verze aplikace. Obsahuje Python i potřebné
knihovny; na cílovém počítači není nutné instalovat Python.

## Spuštění

EXE, `.env` a `.env.example` ponechte ve stejné složce. Dvojklikem se otevře český dashboard;
pokud již služba běží na pozadí, pouze se otevře její existující UI.
Konfigurace a tajné API klíče zůstávají pouze v externím `.env` a nejsou zabalené v EXE.

```powershell
.\AIStockPaperAssistant.exe run
.\AIStockPaperAssistant.exe app
.\AIStockPaperAssistant.exe serve
.\AIStockPaperAssistant.exe status
.\AIStockPaperAssistant.exe healthcheck
.\AIStockPaperAssistant.exe once
.\AIStockPaperAssistant.exe news-once
```

Databáze vzniká v `data\stock_assistant.db` a rotovaný log v `logs\assistant.log`, vždy vedle
EXE. Systémový zámek nedovolí spustit dva schedulery současně. Aplikace podporuje výhradně
`TRADING_MODE=paper`; neobsahuje žádnou live broker exekuci.

Dashboard je dostupný pouze lokálně na `http://127.0.0.1:8765`. Zobrazuje ligu čtyř
samostatných PAPER agentů (včetně jednoho High Volatility profilu pro USA a jednoho pro
Evropu), jejich kapitál, hotovost,
equity, výnos, drawdown, win rate, otevřené pozice a equity křivku. Kapitál lze v UI změnit;
u rozběhnutého portfolia je z bezpečnostních důvodů vyžadován potvrzený reset historie.

## Nový build

```powershell
.\.venv\Scripts\python.exe -m pip install -e ".[dev]"
.\.venv\Scripts\python.exe -m PyInstaller --clean --noconfirm `
  --distpath . --workpath build\pyinstaller AIStockPaperAssistant.spec
```

Soubor `.env` se do buildu úmyslně nepřidává.
