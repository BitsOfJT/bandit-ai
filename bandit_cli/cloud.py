"""Browse Ollama's public cloud model catalog (HTML scrape).

Learning note
-------------
ollama.com has no JSON API for this catalog, so we fetch HTML and pull
out the x-test-* markers (same approach as the old Go CLI). Pure
functions make the parsers easy to unit-test with a saved HTML fixture.
"""

from __future__ import annotations

import re

import httpx
from rich.console import Console

console = Console()

OLLAMA_WEB = "https://ollama.com"

_RE_TITLE = re.compile(r"x-test-search-response-title[^>]*>([^<]+)<")
_RE_CAPABILITY = re.compile(r"x-test-capability[^>]*>([^<]+)<")


def parse_cloud_catalog(html: str) -> list[dict]:
    """Extract {name, capabilities} entries from the search HTML."""
    chunks = html.split("x-test-model")
    models: list[dict] = []
    for chunk in chunks[1:]:  # skip page header before first model
        tm = _RE_TITLE.search(chunk)
        if not tm:
            continue
        name = tm.group(1).strip()
        if not name:
            continue
        caps = [c.strip() for c in _RE_CAPABILITY.findall(chunk) if c.strip()]
        models.append({"name": name, "capabilities": caps})
    return models


def parse_cloud_tags(html: str, name: str) -> list[str]:
    """Extract runnable cloud tags like name:120b-cloud."""
    pattern = re.compile(
        rf"/library/{re.escape(name)}:([a-zA-Z0-9._-]*cloud[a-zA-Z0-9._-]*)"
    )
    seen: set[str] = set()
    tags: list[str] = []
    for match in pattern.finditer(html):
        tag = f"{name}:{match.group(1)}"
        if tag not in seen:
            seen.add(tag)
            tags.append(tag)
    return tags


def fetch_page(url: str) -> str:
    resp = httpx.get(url, headers={"User-Agent": "bandit-cli"}, timeout=10.0)
    resp.raise_for_status()
    return resp.text


def print_cloud_catalog() -> None:
    console.print("[dim]Fetching cloud models from ollama.com...[/]")
    try:
        html = fetch_page(f"{OLLAMA_WEB}/search?c=cloud")
    except Exception as exc:
        console.print(f"[bold red]WARNING:[/] Couldn't reach ollama.com: {exc}")
        return
    models = parse_cloud_catalog(html)
    if not models:
        console.print("[yellow]No cloud models found (catalog page may have changed).[/]")
        return
    console.print("\n[bold cyan]Ollama Cloud Models:[/]")
    for m in models:
        caps = ""
        if m["capabilities"]:
            caps = f" [dim][{', '.join(m['capabilities'])}][/]"
        console.print(f"  [yellow]{m['name']:<28}[/]{caps}")
    console.print(
        "\nCloud models run on Ollama's servers — sign in first with "
        "[cyan]ollama signin[/]."
    )
    console.print(
        "See tags with [magenta]/cloud <name>[/], then "
        "[magenta]/pull <name>:<tag>[/].\n"
    )


def print_cloud_tags(name: str) -> None:
    console.print(f"[dim]Fetching cloud tags for [yellow]{name}[/dim]...[/]")
    try:
        html = fetch_page(f"{OLLAMA_WEB}/library/{name}/tags")
    except Exception as exc:
        console.print(f"[bold red]WARNING:[/] Couldn't fetch tags: {exc}")
        return
    tags = parse_cloud_tags(html, name)
    if not tags:
        console.print(
            f"[yellow]No cloud tags for '{name}'. Check the name with /cloud.[/]\n"
        )
        return
    console.print(f"\n[bold cyan]Cloud tags for {name}:[/]")
    for t in tags:
        console.print(f"  [yellow]{t}[/]")
    console.print(
        f"\nTo use one: [cyan]ollama signin[/], then "
        f"[magenta]/pull {tags[0]}[/] and [magenta]/model {tags[0]}[/].\n"
    )
