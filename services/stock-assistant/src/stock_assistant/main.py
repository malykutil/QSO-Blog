import argparse
import json
import logging
import os
import sys
import threading
import webbrowser
from dataclasses import dataclass

import uvicorn
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from stock_assistant.agent_league import AgentLeague
from stock_assistant.config import Settings, get_settings
from stock_assistant.dashboard import create_dashboard_app
from stock_assistant.db import Repository
from stock_assistant.llm import DisabledAnalyzer, OpenAIAnalyzer
from stock_assistant.logging_config import configure_logging
from stock_assistant.market_data import YahooMarketDataProvider
from stock_assistant.news import GoogleNewsRssProvider, NewsMonitor
from stock_assistant.paper import PaperBroker
from stock_assistant.process_lock import AlreadyRunningError, SingleInstanceLock
from stock_assistant.runner import TradingCycle
from stock_assistant.screening import DeterministicScreener
from stock_assistant.telegram import TelegramNotifier
from stock_assistant.telegram_commands import TelegramCommandService
from stock_assistant.universe import UniverseProvider

logger = logging.getLogger(__name__)


def _use_executable_directory_when_frozen() -> None:
    """Keep .env, data and logs next to the portable Windows executable."""
    if getattr(sys, "frozen", False):
        os.chdir(os.path.dirname(os.path.abspath(sys.executable)))


@dataclass
class Application:
    settings: Settings
    repository: Repository
    cycle: TradingCycle
    news_monitor: NewsMonitor | None
    telegram_commands: TelegramCommandService | None


def build_application(settings: Settings | None = None) -> Application:
    settings = settings or get_settings()
    settings.ensure_directories()
    repository = Repository(
        settings.database_path,
        settings.initial_cash,
        settings.agent_initial_cash,
        settings.agent_min_score,
    )
    repository.initialize()

    analyzer = (
        OpenAIAnalyzer(
            settings.openai_api_key,
            settings.openai_model,
            settings.min_risk_reward,
        )
        if settings.openai_api_key
        else DisabledAnalyzer()
    )
    broker = PaperBroker(
        repository,
        max_risk_fraction=settings.max_risk_per_trade,
        min_risk_reward=settings.min_risk_reward,
    )
    notifier = TelegramNotifier(
        repository,
        settings.telegram_bot_token,
        settings.telegram_chat_id,
        position_update_threshold=settings.position_update_threshold,
    )
    telegram_commands = (
        TelegramCommandService(
            repository=repository,
            broker=broker,
            notifier=notifier,
            bot_token=settings.telegram_bot_token,
            allowed_chat_id=settings.telegram_chat_id,
        )
        if settings.telegram_bot_token and settings.telegram_chat_id
        else None
    )
    news_provider = GoogleNewsRssProvider()
    agent_league = AgentLeague(repository, settings)
    news_monitor = (
        NewsMonitor(
            settings=settings,
            repository=repository,
            provider=news_provider,
            notifier=notifier,
        )
        if settings.news_enabled
        else None
    )
    cycle = TradingCycle(
        settings=settings,
        repository=repository,
        universe=UniverseProvider(
            settings.universe_cache_path, settings.universe_cache_hours
        ),
        market_data=YahooMarketDataProvider(
            period=settings.market_data_period,
            interval=settings.market_data_interval,
            batch_size=settings.market_data_batch_size,
        ),
        screener=DeterministicScreener(),
        analyzer=analyzer,
        broker=broker,
        notifier=notifier,
        agent_league=agent_league,
        news_provider=news_provider if settings.news_enabled else None,
    )
    return Application(
        settings=settings,
        repository=repository,
        cycle=cycle,
        news_monitor=news_monitor,
        telegram_commands=telegram_commands,
    )


def _add_jobs(scheduler, application: Application) -> None:
    scheduler.add_job(
        application.cycle.run,
        CronTrigger(minute="*/5", second=0, timezone="UTC"),
        id="paper-trading-cycle",
        coalesce=True,
        max_instances=1,
        misfire_grace_time=60,
        replace_existing=True,
    )
    if application.telegram_commands is not None:
        scheduler.add_job(
            application.telegram_commands.poll_once,
            IntervalTrigger(
                seconds=application.settings.telegram_poll_seconds,
                timezone="UTC",
            ),
            id="telegram-command-poll",
            coalesce=True,
            max_instances=1,
            misfire_grace_time=30,
            replace_existing=True,
        )
    if application.news_monitor is not None:
        scheduler.add_job(
            application.news_monitor.run,
            IntervalTrigger(
                minutes=application.settings.news_poll_minutes,
                timezone="UTC",
            ),
            id="internet-news-monitor",
            coalesce=True,
            max_instances=1,
            misfire_grace_time=60,
            replace_existing=True,
        )


def _run_initial_jobs(application: Application) -> None:
    application.cycle.run()
    if application.news_monitor is not None:
        application.news_monitor.run()
    if application.telegram_commands is not None:
        application.telegram_commands.poll_once()


def run_scheduler(application: Application) -> None:
    scheduler = BlockingScheduler(timezone="UTC")
    _add_jobs(scheduler, application)
    logger.info(
        "Starting PAPER-only scheduler; model=%s interval=5m",
        application.settings.openai_model,
    )
    _run_initial_jobs(application)
    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        logger.info("Scheduler stopped")


def run_dashboard(application: Application, *, open_browser: bool) -> None:
    scheduler = BackgroundScheduler(timezone="UTC")
    _add_jobs(scheduler, application)
    scheduler.start()
    threading.Thread(
        target=_run_initial_jobs,
        args=(application,),
        name="initial-paper-cycle",
        daemon=True,
    ).start()
    url = (
        f"http://{application.settings.dashboard_host}:"
        f"{application.settings.dashboard_port}"
    )
    if open_browser:
        timer = threading.Timer(1.2, webbrowser.open, args=(url,))
        timer.daemon = True
        timer.start()
    logger.info("Český PAPER dashboard běží na %s", url)
    server = uvicorn.Server(
        uvicorn.Config(
            create_dashboard_app(application.repository, application.settings),
            host=application.settings.dashboard_host,
            port=application.settings.dashboard_port,
            log_level="warning",
            access_log=False,
        )
    )
    try:
        server.run()
    except KeyboardInterrupt:
        logger.info("Dashboard byl zastaven uživatelem")
    finally:
        scheduler.shutdown(wait=False)


def _json_default(value):
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json")
    raise TypeError(f"Object {type(value).__name__} is not JSON serializable")


def main() -> None:
    _use_executable_directory_when_frozen()
    parser = argparse.ArgumentParser(description="PAPER-only AI stock trading assistant")
    parser.add_argument(
        "command",
        nargs="?",
        choices=(
            "app",
            "serve",
            "run",
            "once",
            "news-once",
            "healthcheck",
            "status",
            "position-add",
        ),
        default="app",
    )
    parser.add_argument("--ticker")
    parser.add_argument("--quantity", type=int)
    parser.add_argument("--entry", type=float)
    parser.add_argument("--stop", type=float)
    parser.add_argument("--target-1", type=float)
    parser.add_argument("--target-2", type=float)
    args = parser.parse_args()

    settings = get_settings()
    configure_logging(settings.log_level, settings.log_path)
    application = build_application(settings)

    if args.command == "healthcheck":
        raise SystemExit(0 if application.repository.healthcheck() else 1)
    if args.command == "status":
        print(json.dumps(application.repository.dump_account(), indent=2, default=_json_default))
        return
    if args.command == "position-add":
        required = {
            "--ticker": args.ticker,
            "--quantity": args.quantity,
            "--entry": args.entry,
            "--stop": args.stop,
            "--target-1": args.target_1,
            "--target-2": args.target_2,
        }
        missing = [name for name, value in required.items() if value is None]
        if missing:
            parser.error(f"position-add requires: {', '.join(missing)}")
        broker = application.cycle.broker
        execution = broker.import_existing_position(
            ticker=args.ticker,
            quantity=args.quantity,
            entry_price=args.entry,
            stop_loss=args.stop,
            target_1=args.target_1,
            target_2=args.target_2,
        )
        print(execution.model_dump_json(indent=2))
        return
    if args.command == "once":
        application.cycle.run()
        return
    if args.command == "news-once":
        if application.news_monitor is not None:
            application.news_monitor.run()
        return
    try:
        with SingleInstanceLock(
            "AIStockPaperAssistantScheduler",
            settings.database_path.parent / "assistant.scheduler.lock",
        ):
            if args.command in {"app", "serve"}:
                run_dashboard(application, open_browser=args.command == "app")
            else:
                run_scheduler(application)
    except AlreadyRunningError:
        if args.command == "app":
            webbrowser.open(
                f"http://{settings.dashboard_host}:{settings.dashboard_port}"
            )
            return
        logger.warning("AI Stock PAPER Assistant už běží; druhá instance nebyla spuštěna.")
        raise SystemExit(2) from None
