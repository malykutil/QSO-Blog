import hashlib
import json
from datetime import UTC, datetime
from types import SimpleNamespace

from stock_assistant.llm import OpenAIAnalyzer
from stock_assistant.models import (
    Action,
    CandidateKind,
    NewsArticle,
    ScreeningCandidate,
    TradeAnalysis,
)


class FakeResponses:
    def __init__(self, parsed):
        self.parsed = parsed
        self.kwargs = None

    def parse(self, **kwargs):
        self.kwargs = kwargs
        return SimpleNamespace(output_parsed=self.parsed)


def test_openai_uses_pydantic_structured_output(snapshot):
    parsed = TradeAnalysis(
        ticker="TEST",
        action=Action.WATCH,
        confidence=0.6,
        entry_low=None,
        entry_high=None,
        stop_loss=None,
        target_1=None,
        target_2=None,
        risk_reward=None,
        reason="wait",
        risks=["momentum"],
    )
    responses = FakeResponses(parsed)
    analyzer = OpenAIAnalyzer.__new__(OpenAIAnalyzer)
    analyzer.client = SimpleNamespace(responses=responses)
    analyzer.model = "test-model"
    analyzer.min_risk_reward = 2.5
    candidate = ScreeningCandidate(
        snapshot=snapshot,
        kind=CandidateKind.ENTRY,
        score=5,
        screen_reason="passed",
    )

    article = NewsArticle(
        fingerprint=hashlib.sha256(b"headline").hexdigest(),
        title="Company raises guidance",
        url="https://example.com/story",
        source="Example",
        published_at=datetime.now(UTC),
        ticker="TEST",
        query="TEST stock",
        significance_score=4,
        sentiment="POSITIVE",
    )
    result = analyzer.analyze(candidate, news=[article])
    assert result == parsed
    assert responses.kwargs["text_format"] is TradeAnalysis
    assert responses.kwargs["model"] == "test-model"
    sent = json.loads(responses.kwargs["input"][1]["content"])
    assert sent["market"]["current_price"] == 100.0
    assert sent["minimum_risk_reward"] == 2.5
    assert sent["untrusted_news_headlines"][0]["title"] == "Company raises guidance"
