from stock_assistant.market_data import YahooMarketDataProvider


class FakeResponse:
    def raise_for_status(self):
        return None

    def json(self):
        return {
            "chart": {
                "result": [
                    {"meta": {"longName": "Apple Inc.", "shortName": "Apple"}}
                ]
            }
        }


def test_company_names_are_loaded_from_quote_metadata(monkeypatch):
    monkeypatch.setattr(
        "stock_assistant.market_data.requests.get",
        lambda *args, **kwargs: FakeResponse(),
    )

    names = YahooMarketDataProvider().fetch_names(["AAPL", "AAPL"])

    assert names == {"AAPL": "Apple Inc."}
