import sys
from pathlib import Path
from unittest.mock import Mock, patch

import pytest
import requests

sys.path.insert(0, str(Path(__file__).parent))

from mcp_server import request_api


def test_mcp_request_sends_token_and_surfaces_api_error():
    response = Mock(status_code=400, json=lambda: {"detail": "No readable article found"})
    with patch("mcp_server.requests.request", return_value=response) as send:
        with patch.dict("mcp_server.os.environ", {"P1_API_TOKEN": "secret", "P1_API_URL": "http://127.0.0.1:8765"}):
            with pytest.raises(RuntimeError, match="No readable article found"):
                request_api("POST", "/sources", {"url": "https://example.com"})
    assert send.call_args.kwargs["headers"]["Authorization"] == "Bearer secret"


def test_mcp_reports_api_connection_failure():
    with patch("mcp_server.requests.request", side_effect=requests.ConnectionError("connection refused")):
        with pytest.raises(RuntimeError, match="P1 API unavailable"):
            request_api("GET", "/sources")
