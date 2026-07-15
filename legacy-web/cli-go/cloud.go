package main

import (
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
)

// ollamaWebHost is the public Ollama site used to browse the cloud model
// catalog. It has no JSON API, so we parse the (stable, x-test-* annotated)
// HTML. The parsers below are pure functions so they can be unit-tested
// against a saved fixture.
const ollamaWebHost = "https://ollama.com"

// CloudModel is one entry from the Ollama cloud catalog.
type CloudModel struct {
	Name         string
	Capabilities []string
}

var (
	reCloudTitle      = regexp.MustCompile(`x-test-search-response-title[^>]*>([^<]+)<`)
	reCloudCapability = regexp.MustCompile(`x-test-capability[^>]*>([^<]+)<`)
)

// parseCloudCatalog extracts cloud models from the HTML of
// https://ollama.com/search?c=cloud. Each model is delimited by the
// `x-test-model` attribute; within a block the title carries the model name
// and `x-test-capability` spans carry capability badges (tools, thinking, …).
func parseCloudCatalog(html string) []CloudModel {
	chunks := strings.Split(html, "x-test-model")
	var models []CloudModel
	for i, chunk := range chunks {
		if i == 0 {
			continue // page header before the first model block
		}
		tm := reCloudTitle.FindStringSubmatch(chunk)
		if tm == nil {
			continue
		}
		name := strings.TrimSpace(tm[1])
		if name == "" {
			continue
		}
		var caps []string
		for _, cm := range reCloudCapability.FindAllStringSubmatch(chunk, -1) {
			if c := strings.TrimSpace(cm[1]); c != "" {
				caps = append(caps, c)
			}
		}
		models = append(models, CloudModel{Name: name, Capabilities: caps})
	}
	return models
}

// parseCloudTags extracts the runnable cloud tags (e.g. gpt-oss:120b-cloud)
// for a model from its /library/<name>/tags page.
func parseCloudTags(html, name string) []string {
	re := regexp.MustCompile(`/library/` + regexp.QuoteMeta(name) + `:([a-zA-Z0-9._-]*cloud[a-zA-Z0-9._-]*)`)
	seen := map[string]bool{}
	var tags []string
	for _, m := range re.FindAllStringSubmatch(html, -1) {
		tag := name + ":" + m[1]
		if !seen[tag] {
			seen[tag] = true
			tags = append(tags, tag)
		}
	}
	return tags
}

func fetchWebPage(url string) (string, error) {
	client := &http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "bandit-cli")
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("http %d", resp.StatusCode)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	return string(body), nil
}

func fetchCloudCatalog() ([]CloudModel, error) {
	html, err := fetchWebPage(ollamaWebHost + "/search?c=cloud")
	if err != nil {
		return nil, err
	}
	return parseCloudCatalog(html), nil
}

func fetchCloudTags(name string) ([]string, error) {
	html, err := fetchWebPage(ollamaWebHost + "/library/" + name + "/tags")
	if err != nil {
		return nil, err
	}
	return parseCloudTags(html, name), nil
}

// printCloudCatalog fetches and prints the Ollama cloud model catalog.
func printCloudCatalog() {
	fmt.Printf("\n%sFetching cloud models from ollama.com...%s\n", CGray, CReset)
	models, err := fetchCloudCatalog()
	if err != nil {
		fmt.Printf("\n%sWARNING:%s Couldn't reach ollama.com: %s\n\n", CRed+CBright, CReset, err)
		return
	}
	if len(models) == 0 {
		fmt.Printf("\n%sNo cloud models found (the catalog page may have changed).%s\n\n", CYellow, CReset)
		return
	}
	fmt.Printf("\n%s%sOllama Cloud Models:%s\n", CCyan, CBright, CReset)
	for _, m := range models {
		caps := ""
		if len(m.Capabilities) > 0 {
			caps = fmt.Sprintf(" %s[%s]%s", CGray, strings.Join(m.Capabilities, ", "), CReset)
		}
		fmt.Printf("  %s%-28s%s%s\n", CYellow, m.Name, CReset, caps)
	}
	fmt.Printf("\nCloud models run on Ollama's servers — sign in first with %sollama signin%s.\n", CCyan, CReset)
	fmt.Printf("See a model's runnable tags with %s/cloud <name>%s, then %s/pull <name>:<tag>%s.\n\n", CMagenta, CReset, CMagenta, CReset)
}

// printCloudTags fetches and prints the runnable cloud tags for one model.
func printCloudTags(name string) {
	fmt.Printf("\n%sFetching cloud tags for %s%s%s...%s\n", CGray, CYellow, name, CGray, CReset)
	tags, err := fetchCloudTags(name)
	if err != nil {
		fmt.Printf("\n%sWARNING:%s Couldn't fetch tags for %s: %s\n\n", CRed+CBright, CReset, name, err)
		return
	}
	if len(tags) == 0 {
		fmt.Printf("\n%sNo cloud tags found for '%s'. Check the name against %s/cloud%s.%s\n\n", CYellow, name, CMagenta, CReset, CReset)
		return
	}
	fmt.Printf("\n%s%sCloud tags for %s:%s\n", CCyan, CBright, name, CReset)
	for _, t := range tags {
		fmt.Printf("  %s%s%s\n", CYellow, t, CReset)
	}
	fmt.Printf("\nTo use one: %sollama signin%s, then %s/pull %s%s and %s/model %s%s.\n\n",
		CCyan, CReset, CMagenta, tags[0], CReset, CMagenta, tags[0], CReset)
}
