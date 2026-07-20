"""Bandit CLI entry point — the interactive REPL.

Learning note
-------------
A REPL ("Read-Eval-Print Loop") repeatedly:
  1. reads a line of input
  2. decides what to do (slash-command vs chat)
  3. prints a result
  4. loops

`prompt_toolkit` gives us nicer input than built-in input(): history,
editing keys, and a styled prompt.
"""

from __future__ import annotations

import sys

from prompt_toolkit import PromptSession
from prompt_toolkit.formatted_text import HTML
from prompt_toolkit.history import InMemoryHistory

from bandit_cli.agent import run_agent_turn
from bandit_cli.cloud import print_cloud_catalog, print_cloud_tags
from bandit_cli.config import MODEL_NAME_RE, SEARCH_BACKENDS, RuntimeConfig
from bandit_cli.personas import PERSONALITY_PRESETS
from bandit_cli.providers.base import ChatOptions, ModelInfo
from bandit_cli.tools.registry import build_default_registry
from bandit_cli.providers.ollama import OllamaProvider
from bandit_cli.providers.router import ProviderRouter
from bandit_cli.render import (
    clear_screen,
    console,
    format_size,
    print_banner,
    print_help,
    stream_markdown_reply,
)
from bandit_cli.session import (
    Message,
    Session,
    list_sessions,
    load_session,
    new_session_id,
    save_session,
    title_from_messages,
)


def is_ollama_cloud_model(name: str) -> bool:
    """True for Ollama cloud tags (e.g. gemma4:31b-cloud, GLM-5.2:cloud)."""
    tag = name.lower().rsplit(":", 1)[-1]
    return tag == "cloud" or tag.endswith("-cloud") or "cloud" in tag


def resolve_picker_choice(
    raw: str,
    model_names: list[str],
    current: str,
) -> str:
    """Map startup-picker input to a model name.

    - empty  → current if installed, else the first listed model
    - digit  → 1-based index into model_names
    - other  → exact name if it appears in model_names
    Raises ValueError when the choice is invalid.
    """
    if not model_names:
        raise ValueError("no models available")

    text = raw.strip()
    if not text:
        if current in model_names:
            return current
        return model_names[0]

    if text.isdigit():
        idx = int(text)
        if 1 <= idx <= len(model_names):
            return model_names[idx - 1]
        raise ValueError(f"pick a number between 1 and {len(model_names)}")

    if text in model_names:
        return text
    raise ValueError(f"unknown model: {text}")


def wants_cloud_picker(raw: str) -> bool:
    """True when the user asked to switch into the cloud-model list."""
    return raw.strip().lower() in {"c", "cloud"}


class BanditApp:
    """Owns runtime state for one CLI process."""

    def __init__(self) -> None:
        self.config = RuntimeConfig()
        self.router = ProviderRouter()
        self.session: Session | None = None
        self.custom_prompt = ""
        self.tools = build_default_registry(self.config)
        # Cache tool-capability probes per (provider, model) and remember which
        # models we've already warned about, so we don't nag every turn.
        self._tools_cap_cache: dict[tuple[str, str], bool] = {}
        self._tool_warned: set[tuple[str, str]] = set()

    def _tools_active(self) -> bool:
        """True when tools are on AND the active model can use them.

        Prints a one-time note per model when tools are on but unsupported.
        """
        if not self.config.tools_enabled:
            return False
        provider = self.router.get()
        key = (provider.name, self.config.model)
        if key not in self._tools_cap_cache:
            try:
                self._tools_cap_cache[key] = provider.supports_tools(self.config.model)
            except Exception:
                self._tools_cap_cache[key] = False
        if self._tools_cap_cache[key]:
            return True
        if key not in self._tool_warned:
            self._tool_warned.add(key)
            console.print(
                f"[dim]Tools are on, but [yellow]{self.config.model}[/] can't call "
                "them — replying without tools. Pick a tools-capable model with "
                "[magenta]/models[/].[/]"
            )
        return False

    # ------------------------------------------------------------------
    # Session helpers
    # ------------------------------------------------------------------

    def _system_prompt(self) -> str:
        if self.config.persona == "custom":
            return self.custom_prompt
        preset = PERSONALITY_PRESETS.get(self.config.persona)
        return preset.prompt if preset else ""

    def _sync_system_message(self, messages: list[Message]) -> list[Message]:
        """Ensure messages[0] is the current system prompt (if any)."""
        prompt = self._system_prompt()
        without_system = [m for m in messages if m.role != "system"]
        if prompt:
            return [Message(role="system", content=prompt), *without_system]
        return without_system

    def save_current(self) -> None:
        if self.session is None:
            return
        self.session.title = title_from_messages(self.session.messages)
        self.session.system_prompt = self._system_prompt()
        self.session.model = self.config.model
        self.session.provider = self.config.provider
        self.session.temperature = self.config.temperature
        self.session.top_p = self.config.top_p
        self.session.num_ctx = self.config.num_ctx
        try:
            save_session(self.session)
        except OSError as exc:
            console.print(f"[bold red]WARNING:[/] Failed to save session: {exc}")

    def start_new_session(self) -> None:
        if self.session is not None and any(
            m.role != "system" for m in self.session.messages
        ):
            self.save_current()

        messages = self._sync_system_message([])
        self.session = Session(
            id=new_session_id(),
            title="New Scavenge Session",
            messages=messages,
            system_prompt=self._system_prompt(),
            model=self.config.model,
            provider=self.config.provider,
            temperature=self.config.temperature,
            top_p=self.config.top_p,
            num_ctx=self.config.num_ctx,
        )
        self.save_current()

    def apply_session(self, s: Session) -> None:
        self.session = s
        self.config.temperature = s.temperature
        self.config.top_p = s.top_p
        self.config.num_ctx = s.num_ctx

        # Restore the model onto the right provider slot.
        if s.provider == "openai":
            self.config.openai_model = s.model or self.config.openai_model
        elif s.provider == "ollama":
            self.config.ollama_model = s.model or self.config.ollama_model
        elif s.model:
            # Unknown/missing provider on old-ish files — stash on active slot.
            self.config.model = s.model

        # Prefer the session's provider only if that backend is reachable;
        # otherwise keep whatever resolve_startup already chose.
        wanted = s.provider or self.router.active_name
        ok, _ = self.router.set_active(wanted)
        if ok:
            self.config.provider = self.router.active_name
        else:
            self.config.provider = self.router.active_name

        # Recover persona by matching the stored system prompt.
        self.config.persona = "custom"
        self.custom_prompt = s.system_prompt
        for key, preset in PERSONALITY_PRESETS.items():
            if preset.prompt == s.system_prompt:
                self.config.persona = key
                self.custom_prompt = ""
                break

    # ------------------------------------------------------------------
    # Commands
    # ------------------------------------------------------------------

    def cmd_help(self, _arg: str) -> None:
        print_help()

    def cmd_clear(self, _arg: str) -> None:
        if self.session is None:
            return
        self.session.messages = self._sync_system_message([])
        self.save_current()
        clear_screen()
        print_banner(self.config.model, self.config.provider)
        console.print("[green]Bandit:[/] Current session's trash log emptied!\n")

    def cmd_new(self, _arg: str) -> None:
        self.start_new_session()
        console.print(
            "\n[green]Bandit:[/] Saved current session and initialized a new one! 🦝✨\n"
        )

    def cmd_sessions(self, _arg: str) -> None:
        sessions = list_sessions()
        if not sessions:
            console.print("\n[yellow]No saved sessions found.[/]\n")
            return
        console.print("\n[bold cyan]Saved Scavenge Sessions:[/]")
        for idx, s in enumerate(sessions, start=1):
            marker = " "
            if self.session and s.id == self.session.id:
                marker = "[green]*[/]"
            console.print(
                f"  [{idx}] {marker} [yellow]{s.title:<30}[/] "
                f"({s.provider}/{s.model}) [dim]{s.id}[/]"
            )
        console.print()

    def cmd_load(self, arg: str) -> None:
        if not arg:
            console.print("\n[red]Usage: /load <number_or_id>[/]\n")
            return
        sessions = list_sessions()
        if not sessions:
            console.print("\n[red]No saved sessions found to load.[/]\n")
            return

        target_id = ""
        if arg.isdigit():
            index = int(arg)
            if 1 <= index <= len(sessions):
                target_id = sessions[index - 1].id
        if not target_id:
            for s in sessions:
                if s.id == arg:
                    target_id = s.id
                    break
        if not target_id:
            console.print(f"\n[red]Session not found: {arg}[/]\n")
            return

        try:
            loaded = load_session(target_id)
        except OSError:
            console.print("\n[red]Failed to load session details.[/]\n")
            return

        self.save_current()
        self.apply_session(loaded)
        clear_screen()
        print_banner(self.config.model, self.config.provider)
        console.print(f"[green]Bandit:[/] Loaded session: [yellow]{loaded.id}[/]")
        visible = [m for m in loaded.messages if m.role != "system"]
        console.print(f"History contains [yellow]{len(visible)}[/] messages.\n")
        if visible:
            console.print("[dim]--- Last messages from history ---[/]")
            for m in visible[-5:]:
                if m.role == "user":
                    console.print(f"[bold magenta]You:[/] {m.content}\n")
                else:
                    console.print(f"[bold green]Bandit:[/] {m.content}\n")
            console.print("[dim]----------------------------------[/]\n")

    def cmd_persona(self, arg: str) -> None:
        if not arg:
            preset = PERSONALITY_PRESETS.get(self.config.persona)
            label = preset.name if preset else self.config.persona
            desc = preset.description if preset else ""
            console.print(
                f"\n[cyan]Current Persona:[/] [yellow]{self.config.persona}[/] ({label})"
            )
            if desc:
                console.print(f"[dim]Description:[/] {desc}")
            console.print("\n[cyan]Available Personas:[/]")
            for key in ("hacker", "philosopher", "standard"):
                val = PERSONALITY_PRESETS[key]
                console.print(
                    f"  [magenta]{key}[/] - {val.name} ([dim]{val.description}[/])"
                )
            console.print("\nUse [magenta]/persona <name>[/] to swap.\n")
            return

        target = arg.lower()
        if target not in PERSONALITY_PRESETS:
            console.print(
                f"\n[red]Unknown persona: {target}. Type /persona for options.[/]\n"
            )
            return
        self.config.persona = target
        self.custom_prompt = ""
        if self.session is not None:
            self.session.messages = self._sync_system_message(self.session.messages)
            self.save_current()
        name = PERSONALITY_PRESETS[target].name
        console.print(f"\n[green]Bandit:[/] Persona swapped to [yellow]{name}[/]!\n")

    def cmd_provider(self, arg: str) -> None:
        if not arg:
            console.print(f"\n[cyan]Active provider:[/] [yellow]{self.config.provider}[/]")
            for name in ("openai", "ollama"):
                ok, reason = self.router.get(name).is_available()
                status = "[green]ready[/]" if ok else f"[red]unavailable[/] ({reason})"
                marker = " *" if name == self.config.provider else ""
                console.print(f"  {name}{marker}: {status}")
            console.print(
                "\nSwitch with [magenta]/provider openai[/] or "
                "[magenta]/provider ollama[/].\n"
            )
            return

        ok, message = self.router.set_active(arg.lower())
        if not ok:
            console.print(f"\n[red]{message}[/]\n")
            return
        self.config.provider = self.router.active_name
        self.save_current()
        console.print(f"\n[green]Bandit:[/] {message}\n")
        console.print(
            f"Active model for this provider: [yellow]{self.config.model}[/]\n"
        )

    def _print_model_table(self, provider_name: str, models: list[ModelInfo]) -> None:
        """Render a numbered model list (shared by /models and startup picker)."""
        console.print(f"\n[bold cyan]Models ({provider_name}):[/]")
        for idx, m in enumerate(models, start=1):
            marker = "[green]*[/]" if m.name == self.config.model else " "
            meta_bits = []
            size = format_size(m.size_bytes)
            if size:
                meta_bits.append(size)
            if m.parameter_size:
                meta_bits.append(m.parameter_size)
            meta = f" [dim]({', '.join(meta_bits)})[/]" if meta_bits else ""
            warn = "" if m.chat_capable else " [red][not a chat model][/]"
            console.print(f"  [{idx}] {marker} [yellow]{m.name:<40}[/]{meta}{warn}")

    def cmd_models(self, _arg: str) -> None:
        provider = self.router.get()
        try:
            models = provider.list_models()
        except Exception as exc:
            console.print(f"\n[bold red]WARNING:[/] Couldn't list models: {exc}\n")
            return
        if not models:
            console.print(
                "\n[yellow]No models found.[/] "
                "For Ollama try [magenta]/pull gemma4:e2b[/].\n"
            )
            return
        self._print_model_table(provider.name, models)
        console.print(
            "\nSwitch with [magenta]/model <number>[/] or "
            "[magenta]/model <name>[/].\n"
        )

    def _apply_selected_model(self, chosen: str, *, warm: bool = True) -> None:
        self.config.ollama_model = chosen
        self.save_current()
        console.print(
            f"\n[green]Bandit:[/] Scavenging with [yellow]{chosen}[/]\n"
        )
        if not warm:
            return
        console.print(f"[dim]Warming up {chosen}…[/] ", end="")
        self.router.ollama.preload(chosen)
        console.print("[green]ready[/]\n")

    def _ask_picker_input(self, prompt_label: str = "Model") -> str | None:
        """Read one picker line. None means EOF/Ctrl-C (keep/fallback)."""
        try:
            picker = PromptSession[str]()
            return picker.prompt(
                HTML(f"<ansicyan><b>{prompt_label}&gt;</b></ansicyan> ")
            )
        except (EOFError, KeyboardInterrupt):
            return None

    def _select_from_models(
        self,
        models: list[ModelInfo],
        *,
        label: str,
        allow_cloud_switch: bool,
    ) -> str | None:
        """Show a list and resolve a choice. Returns None if user cancels.

        When allow_cloud_switch is True, input `c` / `cloud` returns the
        sentinel string '__cloud__' so the caller can open the cloud list.
        """
        names = [m.name for m in models]
        self._print_model_table(label, models)

        current = self.config.model
        if current in names:
            default_hint = f"Enter keeps [yellow]{current}[/]"
        else:
            default_hint = (
                f"current [yellow]{current}[/] not in this list — "
                f"Enter picks [yellow]{names[0]}[/]"
            )

        extras = ""
        if allow_cloud_switch:
            extras = ", [cyan]c[/]=cloud models"
        console.print(
            f"\n[bold]Pick a model[/] [dim](1–{len(names)}, or name{extras}; "
            f"{default_hint})[/]"
        )

        raw = self._ask_picker_input()
        if raw is None:
            fallback = current if current in names else names[0]
            console.print(f"\n[dim]Keeping[/] [yellow]{fallback}[/]\n")
            return fallback

        if allow_cloud_switch and wants_cloud_picker(raw):
            return "__cloud__"

        try:
            return resolve_picker_choice(raw, names, current)
        except ValueError as exc:
            fallback = current if current in names else names[0]
            console.print(
                f"\n[yellow]{exc}.[/] Using [yellow]{fallback}[/]\n"
            )
            return fallback

    def _prompt_ollama_model(self) -> None:
        """Each Ollama launch: pick a local model, or switch into cloud picks."""
        if not sys.stdin.isatty():
            return

        try:
            installed = [
                m for m in self.router.ollama.list_models() if m.chat_capable
            ]
        except Exception as exc:
            console.print(
                f"\n[bold red]WARNING:[/] Couldn't list Ollama models: {exc}\n"
            )
            return

        local = [m for m in installed if not is_ollama_cloud_model(m.name)]
        cloud = [m for m in installed if is_ollama_cloud_model(m.name)]

        if not local and not cloud:
            console.print(
                "\n[bold red]WARNING:[/] No Ollama chat models found.\n"
                "  Local:  [magenta]/pull gemma4:e2b[/]\n"
                "  Cloud:  [magenta]/cloud[/] then [magenta]/pull <name>:…-cloud[/]\n"
            )
            return

        chosen: str | None = None

        if local:
            chosen = self._select_from_models(
                local,
                label="ollama local",
                allow_cloud_switch=bool(cloud),
            )
            if chosen == "__cloud__":
                chosen = None  # fall through to cloud list
        elif cloud:
            console.print(
                "\n[yellow]No local models installed.[/] "
                "Showing Ollama cloud models already pulled.\n"
                "[dim]Tip: [/dim][magenta]/pull gemma4:e2b[/] "
                "[dim]for on-device models.[/]\n"
            )

        if chosen is None and cloud:
            chosen = self._select_from_models(
                cloud,
                label="ollama cloud",
                allow_cloud_switch=False,
            )
        elif chosen is None and not cloud:
            console.print(
                "\n[yellow]No cloud models pulled yet.[/] "
                "Browse with [magenta]/cloud[/], then "
                "[magenta]/pull <tag>[/].\n"
            )
            if local:
                # User typed `c` but nothing cloud-side — keep a local default.
                current = self.config.model
                names = [m.name for m in local]
                chosen = current if current in names else names[0]

        if not chosen or chosen == "__cloud__":
            return

        # Cloud models talk to Ollama's servers — skip local warm-up.
        self._apply_selected_model(
            chosen, warm=not is_ollama_cloud_model(chosen)
        )

    def _resolve_model_arg(self, arg: str) -> str:
        if arg.isdigit():
            try:
                models = self.router.get().list_models()
            except Exception:
                return arg
            idx = int(arg)
            if 1 <= idx <= len(models):
                return models[idx - 1].name
        return arg

    def cmd_model(self, arg: str) -> None:
        if not arg:
            console.print(f"\nActive model: [yellow]{self.config.model}[/]")
            self.cmd_models("")
            return
        target = self._resolve_model_arg(arg)
        if not MODEL_NAME_RE.match(target):
            console.print(
                "\n[red]Invalid model name. Use only letters, numbers, :, _, ., /, -[/]\n"
            )
            return
        self.config.model = target
        self.save_current()
        console.print(
            f"\n[green]Bandit:[/] Active LLM swapped to: [yellow]{target}[/]\n"
        )
        provider = self.router.get()
        if isinstance(provider, OllamaProvider):
            console.print(f"[dim]Warming up {target}…[/] ", end="")
            provider.preload(target)
            console.print("[green]ready[/]\n")

    def cmd_cloud(self, arg: str) -> None:
        if not arg:
            print_cloud_catalog()
        else:
            if not MODEL_NAME_RE.match(arg):
                console.print("\n[red]Invalid model name.[/]\n")
                return
            print_cloud_tags(arg)

    def cmd_pull(self, arg: str) -> None:
        if not arg:
            console.print("\n[red]Usage: /pull <model_name>[/]\n")
            return
        provider = self.router.get()
        if not provider.supports_pull():
            # Pull is Ollama-specific — use the ollama backend directly.
            ollama = self.router.ollama
            ok, reason = ollama.is_available()
            if not ok:
                console.print(
                    f"\n[red]/pull needs Ollama, but it's unavailable: {reason}[/]\n"
                )
                return
            provider = ollama
        assert isinstance(provider, OllamaProvider)
        console.print(
            f"\n[green]Bandit:[/] Connecting to Ollama to pull [yellow]{arg}[/]..."
        )
        try:
            for update in provider.pull(arg):
                status = getattr(update, "status", None)
                if status is None and isinstance(update, dict):
                    status = update.get("status", "")
                    completed = update.get("completed") or 0
                    total = update.get("total") or 0
                else:
                    completed = getattr(update, "completed", 0) or 0
                    total = getattr(update, "total", 0) or 0
                if total:
                    pct = completed / total * 100
                    console.print(
                        f"\r[cyan]Downloading {pct:5.1f}% "
                        f"({completed / 1e9:.2f}GB / {total / 1e9:.2f}GB)[/]",
                        end="",
                    )
                elif status:
                    console.print(f"\r[dim]Status: {status:<50}[/]", end="")
            console.print(
                f"\n\n[green]Bandit:[/] Model [yellow]{arg}[/] installed! 🦝💾\n"
            )
        except Exception as exc:
            console.print(f"\n[red]Error pulling model: {exc}[/]\n")

    def cmd_temp(self, arg: str) -> None:
        if not arg:
            console.print(
                f"\nTemperature: [yellow]{self.config.temperature:.1f}[/] "
                "(default: 0.7)\n"
            )
            return
        try:
            val = float(arg)
        except ValueError:
            val = -1
        if not 0.0 <= val <= 2.0:
            console.print(
                "\n[red]Invalid temperature. Must be a number between 0.0 and 2.0.[/]\n"
            )
            return
        self.config.temperature = val
        self.save_current()
        console.print(
            f"\n[green]Bandit:[/] Temperature set to [yellow]{val:.1f}[/]\n"
        )

    def cmd_top_p(self, arg: str) -> None:
        if not arg:
            console.print(
                f"\nTop_p: [yellow]{self.config.top_p:.1f}[/] (default: 0.9)\n"
            )
            return
        try:
            val = float(arg)
        except ValueError:
            val = -1
        if not 0.0 <= val <= 1.0:
            console.print(
                "\n[red]Invalid top_p. Must be a number between 0.0 and 1.0.[/]\n"
            )
            return
        self.config.top_p = val
        self.save_current()
        console.print(f"\n[green]Bandit:[/] Top_p set to [yellow]{val:.1f}[/]\n")

    def cmd_ctx(self, arg: str) -> None:
        if not arg:
            console.print(
                f"\nContext Size (num_ctx): [yellow]{self.config.num_ctx}[/] "
                "tokens (default: 2048)\n"
            )
            return
        try:
            val = int(arg)
        except ValueError:
            val = -1
        if not 256 <= val <= 131072:
            console.print(
                "\n[red]Invalid context size. Integer between 256 and 131072.[/]\n"
            )
            return
        self.config.num_ctx = val
        self.save_current()
        console.print(
            f"\n[green]Bandit:[/] Context size set to [yellow]{val}[/] tokens\n"
        )

    def cmd_settings(self, arg: str) -> None:
        parts = arg.split()
        if not parts:
            state = "[green]on[/]" if self.config.tools_enabled else "[red]off[/]"
            provider = self.router.get()
            try:
                cap = provider.supports_tools(self.config.model)
            except Exception:
                cap = False
            cap_txt = "[green]yes[/]" if cap else "[yellow]no[/]"
            console.print("\n[bold cyan]Settings:[/]")
            console.print(f"  [magenta]tools[/]   : {state}")
            console.print(f"  [magenta]search[/]  : [yellow]{self.config.search_backend}[/]")
            console.print(
                f"  [dim]active model[/] [yellow]{self.config.model}[/] "
                f"[dim]tool-capable:[/] {cap_txt}"
            )
            console.print(
                "\nChange with [magenta]/settings tools on|off[/] or "
                "[magenta]/settings search duckduckgo|brave[/].\n"
            )
            return

        key = parts[0].lower()
        val = parts[1].lower() if len(parts) > 1 else ""
        if key == "tools":
            if val in ("on", "off"):
                self.config.tools_enabled = val == "on"
                console.print(
                    f"\n[green]Bandit:[/] Tools [yellow]{val}[/].\n"
                )
            else:
                console.print("\n[red]Usage: /settings tools on|off[/]\n")
        elif key == "search":
            if val in SEARCH_BACKENDS:
                self.config.search_backend = val
                console.print(
                    f"\n[green]Bandit:[/] Search backend set to [yellow]{val}[/].\n"
                )
            else:
                console.print(
                    f"\n[red]Unknown backend '{val}'. Options: "
                    f"{', '.join(SEARCH_BACKENDS)}.[/]\n"
                )
        else:
            console.print(
                f"\n[red]Unknown setting '{key}'. Try tools or search.[/]\n"
            )

    def cmd_tools(self, _arg: str) -> None:
        console.print("\n[bold cyan]Tools:[/]")
        active = self._tools_active_quiet()
        feature = "[green]on[/]" if self.config.tools_enabled else "[red]off[/]"
        console.print(f"  feature: {feature}  active-for-model: "
                      f"{'[green]yes[/]' if active else '[yellow]no[/]'}")
        for tool in self.tools.all_tools():
            mark = "[green]*[/]" if self.tools.is_enabled(tool.name) else " "
            console.print(f"  {mark} [yellow]{tool.name}[/] — [dim]{tool.description}[/]")
        console.print(
            "\nToggle the feature with [magenta]/settings tools on|off[/].\n"
        )

    def _tools_active_quiet(self) -> bool:
        """Like _tools_active but never prints (for status displays)."""
        if not self.config.tools_enabled:
            return False
        provider = self.router.get()
        try:
            return provider.supports_tools(self.config.model)
        except Exception:
            return False

    def dispatch(self, line: str) -> bool:
        """
        Handle one input line.
        Returns False if the REPL should exit.
        """
        if line.startswith("/"):
            parts = line.split(maxsplit=1)
            command = parts[0].lower()
            arg = parts[1].strip() if len(parts) > 1 else ""

            if command == "/exit":
                console.print(
                    "\n[green]Bandit:[/] Heading back into the vents. "
                    "Keep it clean! 🦝🚪\n"
                )
                return False

            handlers = {
                "/help": self.cmd_help,
                "/clear": self.cmd_clear,
                "/new": self.cmd_new,
                "/sessions": self.cmd_sessions,
                "/load": self.cmd_load,
                "/persona": self.cmd_persona,
                "/provider": self.cmd_provider,
                "/models": self.cmd_models,
                "/model": self.cmd_model,
                "/cloud": self.cmd_cloud,
                "/pull": self.cmd_pull,
                "/temp": self.cmd_temp,
                "/top_p": self.cmd_top_p,
                "/ctx": self.cmd_ctx,
                "/settings": self.cmd_settings,
                "/tools": self.cmd_tools,
            }
            handler = handlers.get(command)
            if handler is None:
                console.print(
                    f"\n[red]Unknown command: {command}. Type /help for assistance.[/]\n"
                )
            else:
                handler(arg)
            return True

        # Normal chat turn
        assert self.session is not None
        turn_start = len(self.session.messages)
        self.session.messages.append(Message(role="user", content=line))
        self.save_current()

        provider = self.router.get()
        options = ChatOptions(
            temperature=self.config.temperature,
            top_p=self.config.top_p,
            num_ctx=self.config.num_ctx,
        )
        try:
            if self._tools_active():
                reply = run_agent_turn(
                    provider,
                    self.config.model,
                    self.session.messages,
                    options,
                    self.tools,
                )
            else:
                tokens = provider.chat_stream(
                    self.config.model, self.session.messages, options
                )
                reply = stream_markdown_reply(tokens)
            self.session.messages.append(Message(role="assistant", content=reply))
            self.save_current()
        except Exception as exc:
            # Roll back the whole turn (user + any tool/assistant scratch
            # messages) so a failed turn isn't stuck in history.
            del self.session.messages[turn_start:]
            self.save_current()
            console.print(f"\n[bold red]Error:[/] {exc}")
            low = str(exc).lower()
            if "api key" in low or "auth" in low:
                console.print(
                    "[yellow]Hint:[/] Set [cyan]OPENAI_API_KEY[/] or "
                    "[magenta]/provider ollama[/].\n"
                )
            elif "not found" in low or "pull" in low:
                console.print(
                    f"[yellow]Hint:[/] Try [magenta]/pull {self.config.model}[/] "
                    "or [magenta]/models[/].\n"
                )
            elif "connection" in low or "refused" in low:
                console.print(
                    "[yellow]Hint:[/] Can't reach the backend. "
                    "Check OpenAI key / start Ollama.\n"
                )
            else:
                console.print()
        return True

    # ------------------------------------------------------------------
    # Startup + loop
    # ------------------------------------------------------------------

    def startup(self) -> None:
        clear_screen()
        self.router.resolve_startup(self.config)

        # Resume newest session if any, else start fresh.
        existing = list_sessions()
        if existing:
            try:
                self.apply_session(load_session(existing[0].id))
            except OSError:
                self.start_new_session()
        else:
            self.start_new_session()

        for note in self.router.startup_notes:
            console.print(f"[dim]{note}[/]")
        console.print()

        # Every Ollama launch: pick from models actually installed on device.
        if self.config.provider == "ollama":
            self._prompt_ollama_model()

        print_banner(self.config.model, self.config.provider)

        if self.session and any(m.role != "system" for m in self.session.messages):
            console.print(
                f"[green]Bandit:[/] Resumed previous session: "
                f"[yellow]{self.session.id}[/]\n"
            )

    def run(self) -> int:
        self.startup()
        prompt_session: PromptSession[str] = PromptSession(history=InMemoryHistory())
        while True:
            try:
                line = prompt_session.prompt(HTML("<ansimagenta><b>You&gt;</b></ansimagenta> "))
            except (EOFError, KeyboardInterrupt):
                console.print(
                    "\n\n[green]Bandit:[/] Heading back into the vents. "
                    "Keep it clean! 🦝🚪\n"
                )
                return 0
            trimmed = line.strip()
            if not trimmed:
                continue
            if not self.dispatch(trimmed):
                return 0


def main() -> None:
    """Console-script entry point (see pyproject.toml [project.scripts])."""
    try:
        raise SystemExit(BanditApp().run())
    except Exception as exc:  # last-resort crash guard
        console.print(f"[bold red]Fatal:[/] {exc}")
        raise SystemExit(1) from exc


if __name__ == "__main__":
    main()
