from stock_assistant.universe import UniverseProvider


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
