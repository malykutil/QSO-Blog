# AI Stock Trading Assistant (PAPER ONLY)

Produkčně strukturovaný Python servis pro pětiminutový screening akcií z indexů
NASDAQ-100 a S&P 500. První filtr je čistě deterministický a do OpenAI API odejdou
jen kandidáti, kteří jím prošli. Aplikace **neobsahuje broker integraci ani žádnou
možnost obchodovat skutečné peníze**.

> Nejde o investiční doporučení. Výchozí zdroj Yahoo Finance přes `yfinance` je vhodný
> pro paper trading a vývoj, není to garantovaný burzovní feed. Pro regulovaný nebo
> SLA provoz implementujte jiný market-data provider; bezpečnostní a obchodní vrstva
> může zůstat beze změny.

## Co projekt dělá

- APScheduler spouští jeden cyklus každých 5 minut; překryv běhů je zakázaný.
- Podle NYSE kalendáře se mimo řádné obchodní hodiny a o svátcích cyklus bezpečně přeskočí.
- Universe se načítá z veřejných seznamů S&P 500 a Nasdaq-100 a 24 hodin cachuje.
- OHLCV má výchozí timeframe 5 minut a historii 10 dní (dostatek pro EMA200).
- Počítá EMA20, EMA50, EMA200, RSI(14), MACD(12,26,9), ATR(14) a relativní volume(20).
- Deterministický vstupní filtr vyžaduje bullish EMA stack, RSI 50–70, kladný MACD
  histogram a relativní volume alespoň 1,2.
- Do LLM odejde maximálně `MAX_LLM_CANDIDATES` nejlepších kandidátů za cyklus.
- OpenAI Responses API používá Pydantic Structured Outputs (`responses.parse`), takže
  odpověď odpovídá přesnému JSON schématu. Tento postup odpovídá
  [oficiální OpenAI dokumentaci](https://developers.openai.com/api/docs/guides/structured-outputs).
- Paper účet, otevřené pozice, signály, obchody, alerty a běhy cyklu jsou v SQLite.
- Lokální český dashboard porovnává čtyři izolované PAPER strategie, jejich equity,
  výnos, drawdown, win rate, obchody a otevřené pozice.
- Telegram posílá jen skutečně provedené PAPER `BUY`/`SELL`; stejnou nevýznamně
  změněnou zprávu znovu nepošle.
- U otevřených paper pozic posílá také průběžný `PAPER UPDATE` s nerealizovaným P/L,
  vzdáleností ke stop-lossu a oběma targetům. První validní snapshot odešle okamžitě,
  další až po výchozí změně ceny alespoň 0,5 % (`POSITION_UPDATE_THRESHOLD`).
- Telegram funguje také jako zabezpečené ovládání. Každých 10 sekund přijímá příkazy
  výhradně z nakonfigurovaného `TELEGRAM_CHAT_ID`; ostatní chaty ignoruje.

### Telegram příkazy

```text
/add AAPL 10 220 215 233 240
/positions
/status
/help
```

`/add` importuje existující PAPER pozici v pořadí ticker, počet, entry, stop, target 1,
target 2. Platí stejná kontrola stop-lossu a maximálně 1% rizika. Bot nikdy neposílá
příkaz skutečnému brokerovi.

## Bezpečnostní invarianty

LLM není exekuční ani cenový zdroj. Server po každé odpovědi znovu kontroluje:

1. ticker musí odpovídat screenovanému tickeru;
2. cena pochází výhradně z posledního validního OHLCV baru a nesmí být starší než limit;
3. `BUY` musí mít entry band obsahující skutečnou paper fill cenu;
4. stop-loss musí existovat a ležet pod skutečnou fill cenou;
5. oba targety musí být správně seřazené;
6. server sám přepočítá R:R k `target_1` a vyžaduje nejméně 1:2,5;
7. velikost pozice je celé číslo a riziko do stop-lossu je nejvýše 1 % aktuální equity;
8. bez validních nebo čerstvých dat se neotevře ani neuzavře žádná pozice;
9. pyramiding je vypnutý a nelze otevřít druhou pozici stejného tickeru;
10. `TRADING_MODE` přijímá pouze hodnotu `paper`.

Stop-loss a `target_2` jsou hlídané deterministicky před LLM. `target_1` je informativní;
první verze neprovádí částečné výstupy. Pokud chybí `OPENAI_API_KEY`, screening může
proběhnout, ale hlavní GPT portfolio žádný nový obchod neotevře. Čtyři srovnávací PAPER
strategie pracují deterministicky a fungují i bez OpenAI klíče.

## Český dashboard a liga strategií

Dvojklik na `AIStockPaperAssistant.exe` otevře lokální UI na
`http://127.0.0.1:8765`. Dashboard není vystavený do internetu. Obsahuje čtyři účty,
které sdílejí jen validovaná tržní data, ale nikoli peníze nebo pozice:

- **Trend** – vyžaduje rostoucí EMA stack a zdravé momentum;
- **Breakout** – hledá průraz dvacetibarového maxima se zvýšeným volume;
- **Momentum** – sleduje dvacetibarové momentum, RSI, MACD a relativní volume;
- **Hybrid** – kombinuje trend s breakout/momentum podmínkou a vyšším skóre.

Každý začíná standardně s 10 000 USD, riskuje nejvýše 0,5 % equity na obchod, nejvýše
2 % celého portfolia a nejvýše 20 % equity v jednom tickeru. Tyto hodnoty lze změnit
v `.env`. Počáteční kapitál každého agenta lze změnit přímo v UI. Pokud už má agent
pozice nebo historii, API vyžaduje výslovně potvrzený reset, aby se nic nesmazalo omylem.
Jde o srovnání obchodních strategií, nikoli o čtyři samostatné OpenAI modely.

Pro kontejnerové nasazení lze dashboard bezpečně vystavit přes
`DASHBOARD_HOST=0.0.0.0` pouze tehdy, když je současně nastavený náhodný
`DASHBOARD_API_TOKEN` o délce alespoň 32 znaků. Datové a kapitálové API potom
vyžaduje hlavičku `Authorization: Bearer <token>`. Healthcheck nevrací portfolio
a zůstává dostupný pro dohled hostingové platformy.

## GPT JSON schéma

Každý klíč je povinný. Pro nepoužitelné cenové úrovně vrací model `null`.

```json
{
  "ticker": "AAPL",
  "action": "BUY",
  "confidence": 0.78,
  "entry_low": 224.1,
  "entry_high": 225.0,
  "stop_loss": 221.0,
  "target_1": 235.0,
  "target_2": 241.0,
  "risk_reward": 2.5,
  "reason": "Trend and momentum align with above-average volume.",
  "risks": ["Broad-market reversal", "Volume may normalize"]
}
```

Povolené akce jsou `BUY`, `WATCH`, `HOLD`, `SELL`. I schema-validní odpověď může být
serverem zamítnuta a důvod se uloží do tabulky `signals`.

## Lokální instalace

Vyžaduje Python 3.12+.

```bash
python -m venv .venv
# Linux/macOS: source .venv/bin/activate
# Windows PowerShell:
.venv\Scripts\Activate.ps1
pip install -e ".[dev]"
Copy-Item .env.example .env   # Windows
# cp .env.example .env        # Linux/macOS
```

V `.env` vyplňte minimálně `OPENAI_API_KEY`. Telegram je volitelný; pokud jej chcete,
musí být nastavené zároveň `TELEGRAM_BOT_TOKEN` a `TELEGRAM_CHAT_ID`.

Pro jednorázový lokální smoke test lze omezit počet symbolů:

```dotenv
UNIVERSE_OVERRIDE=AAPL,MSFT,NVDA
RUN_OUTSIDE_MARKET_HOURS=true
```

## Spuštění

```bash
# Český dashboard, scheduler a automatické otevření prohlížeče
python -m stock_assistant app

# Český dashboard a scheduler bez otevření prohlížeče
python -m stock_assistant serve

# Trvalý scheduler + okamžitý první cyklus
python -m stock_assistant run

# Právě jeden cyklus (stále respektuje obchodní hodiny)
python -m stock_assistant once

# Stav paper účtu, pozic a posledních obchodů
python -m stock_assistant status

# Import již existující PAPER pozice do monitoringu
python -m stock_assistant position-add --ticker AAPL --quantity 10 \
  --entry 220 --stop 215 --target-1 233 --target-2 240

# SQLite/liveness kontrola
python -m stock_assistant healthcheck
```

## Automatické spuštění na Windows

Hotový samostatný build je `AIStockPaperAssistant.exe`. Obsahuje vlastní Python runtime;
konfiguraci a API klíče načítá z externího `.env` ve stejné složce. Příkazy a postup nového
buildu popisuje `README-EXE.md`. Systémový zámek zabrání souběžnému spuštění dvou schedulerů.

Na tomto počítači je zaregistrovaná úloha Plánovače úloh `AIStockPaperAssistant`. Spustí
`AIStockPaperAssistant.exe serve` při přihlášení uživatele, běží skrytě a při pádu se až
pětkrát pokusí službu znovu spustit. Rotovaný provozní log je v `logs/assistant.log`.
Dashboard lze kdykoli otevřít dvojklikem na stejné EXE. Ruční kontrola:

```powershell
Get-ScheduledTask -TaskName AIStockPaperAssistant
Get-Content .\logs\assistant.log -Tail 50
```

## Automatický internetový news monitor

News monitor běží každých 5 minut i mimo obchodní hodiny. Bez dalšího API klíče načítá
veřejný Google News RSS feed pro celý americký akciový trh a samostatně pro každou otevřenou
paper pozici. U akcií, které projdou deterministickým screeningem, načte čerstvé titulky ještě
před strukturovanou GPT analýzou.

- každý titulek se normalizuje a pod SHA-256 fingerprintem uloží do SQLite tabulky
  `news_articles`, takže se stejná zpráva neposílá opakovaně;
- do Telegramu odcházejí jen nové významné události podle deterministického skóre; při prvním
  spuštění nejvýše jedna, potom nejvýše tři za jeden cyklus;
- `/news` v Telegramu zobrazí posledních pět uložených zpráv;
- titulky, zdroje a URL jsou považované za nedůvěryhodná externí data. GPT nesmí následovat
  instrukce z jejich obsahu, používat je jako zdroj ceny ani otevřít obchod pouze podle zprávy;
- výpadek RSS pouze zaloguje chybu. Nezastaví sledování pozic a nikdy nevede k obchodu bez dat.

Ruční ověření monitoru:

```bash
python -m stock_assistant news-once
```

Chování řídí proměnné `NEWS_*` v `.env.example`. Google News RSS je veřejný agregovaný zdroj
bez garantovaného SLA; pro komerční provoz lze `NewsProvider` nahradit licencovaným feedem bez
změny databáze, deduplikace, Telegramu nebo risk vrstvy.

## Docker

```bash
Copy-Item .env.example .env   # nebo: cp .env.example .env
docker compose up --build -d
docker compose logs -f stock-assistant
```

Named volume `stock-assistant-data` drží SQLite databázi a universe cache persistentně
i po výměně kontejneru. Kontejner běží jako neprivilegovaný uživatel. Do image se
nekopíruje `.env`; tajné hodnoty dodává Compose až při startu. Docker varianta běží
záměrně jako headless scheduler; lokální UI je určené pro Windows EXE.

## Testy a kvalita

```bash
pytest
pytest --cov=stock_assistant --cov-report=term-missing
ruff check .
```

Testy nepoužívají živé tržní ani OpenAI/Telegram API. Síťové klienty jsou oddělené a
mockovatelné.

## Provozní poznámky

- První start potřebuje přístup k internetu pro seznam constituentů. Po úspěchu se uloží
  `data/universe.json`; při pozdějším výpadku se použije i starší cache. Bez cache i sítě
  cyklus skončí bez obchodu.
- `yfinance` může vrátit jen část tickerů. Každý chybějící ticker se samostatně vyřadí;
  žádná cena se nedoplňuje ani neodhaduje.
- Logy jdou strukturovaně po řádcích na stdout, což je vhodné pro Docker log driver.
- SQLite používá WAL, `busy_timeout` a transakci `BEGIN IMMEDIATE` při paper exekuci.
- Při úspěšné paper exekuci se nejdřív transakčně zapíše účet a obchod, až potom se posílá
  Telegram. Výpadek Telegramu proto neporuší ledger.

## Struktura

```text
src/stock_assistant/
  market_data.py   # batch OHLCV, bez imputace cen
  universe.py      # NASDAQ-100 + S&P 500 a cache
  indicators.py    # technické indikátory
  screening.py     # deterministický první filtr
  llm.py           # OpenAI Structured Outputs
  news.py          # RSS monitoring, scoring a deduplikace zpráv
  risk.py          # nezávislá validace a position sizing
  paper.py         # pouze SQLite paper broker
  agent_league.py  # čtyři izolované deterministické PAPER strategie
  dashboard.py     # lokální české FastAPI UI/API
  db.py            # SQLite schema, metriky a transakce
  telegram.py      # BUY/SELL alert + deduplikace
  runner.py        # orchestrace jednoho cyklu
  main.py          # CLI a pětiminutový scheduler
```
