from stock_assistant.universe import EuropeanUniverseProvider, UniverseProvider


def test_override_is_normalized_without_network(tmp_path):
    provider = UniverseProvider(tmp_path / "universe.json")
    assert provider.get_symbols([" brk.b ", "AAPL", "aapl"]) == ["AAPL", "BRK-B"]


def test_extracts_table_whose_header_is_first_data_row():
    html = """
    <table>
      <tr><td>Symbol</td><td>Company Name</td></tr>
      <tr><td>AAPL</td><td>Apple Inc.</td></tr>
      <tr><td>MSFT</td><td>Microsoft Corp.</td></tr>
    </table>
    """
    assert UniverseProvider._extract_column(html, ("Ticker", "Symbol")) == ["AAPL", "MSFT"]


def test_europe_override_preserves_yahoo_exchange_suffix(tmp_path):
    provider = EuropeanUniverseProvider(tmp_path / "europe-universe.json")

    assert provider.get_symbols([" ads.de ", "SAN.PA", "ads.de"]) == [
        "ADS.DE",
        "SAN.PA",
    ]


def test_europe_extracts_yahoo_tickers_from_constituent_table(tmp_path, monkeypatch):
    provider = EuropeanUniverseProvider(tmp_path / "europe-universe.json")
    tickers = "".join(f"<tr><td>TEST{index}.DE</td></tr>" for index in range(50))
    html = f"<table><tr><th>Ticker</th></tr>{tickers}</table>"
    monkeypatch.setattr(provider, "_fetch_html", lambda _url: html)

    symbols = provider.get_symbols()

    assert len(symbols) == 50
    assert "TEST0.DE" in symbols
