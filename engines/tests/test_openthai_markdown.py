import pytest

from ocr_playground.engines import EngineUnavailable
from ocr_playground.engines.openthai_markdown import OpenThaiMarkdown


def test_without_a_downloaded_model_it_says_how_to_get_one(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENTHAI_MD_DIR", str(tmp_path))
    monkeypatch.delenv("OPENTHAI_MD_BASE_URL", raising=False)
    with pytest.raises(EngineUnavailable, match="uv run ocr download openthai-markdown"):
        OpenThaiMarkdown.from_env()


def test_client_without_weights_still_needs_the_download_for_local_inference(tmp_path, monkeypatch):
    (tmp_path / "nemotron_parse").mkdir()
    (tmp_path / "nemotron_parse" / "inference.py").write_text("")
    monkeypatch.setenv("OPENTHAI_MD_DIR", str(tmp_path))
    monkeypatch.delenv("OPENTHAI_MD_BASE_URL", raising=False)
    with pytest.raises(EngineUnavailable, match="no weights"):
        OpenThaiMarkdown.from_env()
