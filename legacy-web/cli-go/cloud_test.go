package main

import "testing"

// Mirrors the relevant structure of https://ollama.com/search?c=cloud.
const cloudCatalogFixture = `
<html><body>
<ul role="list">
  <li x-test-model class="flex items-baseline border-b py-6">
    <span x-test-search-response-title>gpt-oss</span>
    <span x-test-capability class="badge">tools</span>
    <span x-test-capability class="badge">thinking</span>
    <span class="badge cloud">cloud</span>
    <span x-test-pull-count>48.6K</span>
  </li>
  <li x-test-model class="flex items-baseline border-b py-6">
    <span x-test-search-response-title>deepseek-v4-pro</span>
    <span x-test-capability class="badge">thinking</span>
    <span class="badge cloud">cloud</span>
  </li>
</ul>
</body></html>`

func TestParseCloudCatalog(t *testing.T) {
	models := parseCloudCatalog(cloudCatalogFixture)
	if len(models) != 2 {
		t.Fatalf("expected 2 cloud models, got %d: %+v", len(models), models)
	}
	if models[0].Name != "gpt-oss" {
		t.Errorf("expected first model 'gpt-oss', got %q", models[0].Name)
	}
	if len(models[0].Capabilities) != 2 || models[0].Capabilities[0] != "tools" || models[0].Capabilities[1] != "thinking" {
		t.Errorf("unexpected capabilities for gpt-oss: %v", models[0].Capabilities)
	}
	if models[1].Name != "deepseek-v4-pro" {
		t.Errorf("expected second model 'deepseek-v4-pro', got %q", models[1].Name)
	}
}

func TestParseCloudCatalog_Empty(t *testing.T) {
	if got := parseCloudCatalog("<html><body>nothing here</body></html>"); len(got) != 0 {
		t.Errorf("expected no models, got %v", got)
	}
}

const cloudTagsFixture = `
<a href="/library/gpt-oss:latest">latest</a>
<a href="/library/gpt-oss:20b-cloud">20b-cloud</a>
<a href="/library/gpt-oss:120b-cloud">120b-cloud</a>
<a href="/library/gpt-oss:120b-cloud">120b-cloud (dup)</a>
<a href="/library/gpt-oss:20b">20b local</a>`

func TestParseCloudTags(t *testing.T) {
	tags := parseCloudTags(cloudTagsFixture, "gpt-oss")
	if len(tags) != 2 {
		t.Fatalf("expected 2 cloud tags (deduped, cloud-only), got %d: %v", len(tags), tags)
	}
	want := map[string]bool{"gpt-oss:20b-cloud": true, "gpt-oss:120b-cloud": true}
	for _, tag := range tags {
		if !want[tag] {
			t.Errorf("unexpected tag %q", tag)
		}
	}
}
