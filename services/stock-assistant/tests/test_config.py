import pytest
from pydantic import ValidationError

from stock_assistant.config import Settings


def test_only_paper_mode_is_accepted(tmp_path):
    with pytest.raises(ValidationError):
        Settings(
            trading_mode="live",
            database_path=tmp_path / "db.sqlite",
            universe_cache_path=tmp_path / "universe.json",
        )


def test_maximum_risk_cannot_exceed_one_percent():
    with pytest.raises(ValidationError):
        Settings(max_risk_per_trade=0.0101)
    with pytest.raises(ValidationError):
        Settings(agent_high_volatility_risk_per_trade=0.0101)


def test_partial_telegram_configuration_is_rejected():
    with pytest.raises(ValidationError):
        Settings(telegram_bot_token="secret", telegram_chat_id=None)


def test_dashboard_cannot_bind_to_external_interface():
    with pytest.raises(ValidationError):
        Settings(dashboard_host="0.0.0.0")


def test_dashboard_can_bind_to_container_with_api_token():
    settings = Settings(dashboard_host="0.0.0.0", dashboard_api_token="a" * 32)
    assert settings.dashboard_host == "0.0.0.0"
