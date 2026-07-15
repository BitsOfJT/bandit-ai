"""Tests for cloud catalog HTML parsers."""

from bandit_cli.cloud import parse_cloud_catalog, parse_cloud_tags


SAMPLE_CATALOG = """
<html>
<div x-test-model>
  <span x-test-search-response-title>gpt-oss</span>
  <span x-test-capability>tools</span>
  <span x-test-capability>thinking</span>
</div>
<div x-test-model>
  <span x-test-search-response-title>llama4</span>
</div>
</html>
"""

SAMPLE_TAGS = """
<a href="/library/gpt-oss:120b-cloud">120b-cloud</a>
<a href="/library/gpt-oss:20b-cloud">20b-cloud</a>
<a href="/library/gpt-oss:120b-cloud">dup</a>
"""


def test_parse_cloud_catalog():
    models = parse_cloud_catalog(SAMPLE_CATALOG)
    assert len(models) == 2
    assert models[0]["name"] == "gpt-oss"
    assert models[0]["capabilities"] == ["tools", "thinking"]
    assert models[1]["name"] == "llama4"
    assert models[1]["capabilities"] == []


def test_parse_cloud_tags_dedupes():
    tags = parse_cloud_tags(SAMPLE_TAGS, "gpt-oss")
    assert tags == ["gpt-oss:120b-cloud", "gpt-oss:20b-cloud"]
