"""Terminal rendering with Rich.

Learning note
-------------
Rich turns plain text into colored, markdown-aware terminal output. We use
Console.print for static bits (banner, lists) and a Live/Markdown approach
for streaming replies so tokens appear as they arrive.
"""

from __future__ import annotations

from rich.console import Console
from rich.live import Live
from rich.markdown import Markdown
from rich.panel import Panel
from rich.text import Text

from bandit_cli import __version__

# Shared console — force_terminal=None lets Rich detect TTY vs pipes.
console = Console()

# Bandit "neon" accents for the banner (Rich markup, not raw ANSI).
_BANNER_RACCOON = r"""
[bright_black].                                                    .[/]
[bright_black].                                                    .[/]
[bright_black].                                                    .[/]
          [green].---:.[/]                        [green].:--:[/]         [bright_black].[/]
        [green].:#*++**=: .[/]                [green]..-+*+++#*..[/]      [bright_black]:[/]
        [green].+*   .:=*=...:::------:::...[/][magenta]++-:.  .#:.[/]      [bright_black].[/]
       [green]..=*   [/][magenta]:-:.[/][green]== --::--==--::=:. [/][magenta]+-.:-:  .#:.[/]      [bright_black].[/]
        [green].:#=   [/][magenta].-:[/][green].:................:.:-.  .++..[/]      [bright_black].[/]
        [green]..:#=. .....:--::=- .=-::--:...:. .+*..[/]
         [bright_black]:[/][magenta].-*-:...:-=-:[/][green]*+-- .--*+[/][magenta]==-:...:=*...[/]       [bright_black]:[/]
       [bright_black]..:::[/][magenta]=:.:[/][green]=**#%#=:%#.  -%*:+#%#*+=:[/][magenta].-=.:.[/]       [bright_black].[/]
       [green].::.-.---=++=:-=.-*-..=+.:=:-=+==--.:: :[/]       [bright_black].[/]
        [green]..+.:=..**:.[/]      [green]::.. **-.[/]      [magenta].-.-=..[/]      [bright_black]:[/]
       [magenta].:*=+%+::*: ::.         +. ...    :*%+*+..[/]     [bright_black].[/]
      [green]..==--. =.[/]   [bright_black].:. .  .::.    ..  ::..[/] [magenta]:==*-..[/]    [bright_black].[/]
      [green].--..[/]    [bright_black]:........[/][magenta]-#=::**:[/]     [bright_black]::..[/]    [magenta].:=:[/]     [bright_black]:[/]
      [bright_black]...-:.    :::...[/][green]=#@%=[/][magenta]:-[/][green]+@@#-[/]  [bright_black]....    .::..[/]     [bright_black]:[/]
       [bright_black]..--:.    .:::+#@#.[/][magenta]-++::[/][green]@%#=::..[/]   [bright_black].::-:.[/]
         [bright_black]..:::-::::[/][green]-=+*#*..  .:#*+=-[/][bright_black]:::::::-..[/]        [bright_black].[/]
           [bright_black].:::::.:::..--::[/] [magenta].:--:..:::.::::..[/]         [bright_black].[/]
"""

_TITLE = """[bold green]______                 _ _ _      ___  _____[/]
[bold green]| ___ \\               | (_) |    / _ \\|_   _|[/]
[bold green]| |_/ / __ _ _ __   __| |_| |_  / /_\\ \\ | |[/]
[bold green]| ___ \\/ _` | '_ \\ / _` | | __| |  _  | | |[/]
[bold green]| |_/ / (_| | | | | (_| | | |_  | | | |_| |_[/]
[bold green]\\____/ \\__,_|_| |_|\\__,_|_|\\__| \\_| |_/\\___/[/]
"""


def clear_screen() -> None:
    console.clear()


def print_banner(model: str, provider: str) -> None:
    """Print the Bandit ASCII logo + status line."""
    console.print(_TITLE)
    console.print(_BANNER_RACCOON)
    console.print(
        f"  [bold]Active:[/] [yellow]{provider}/{model}[/]  "
        f"[bold]Status:[/] [green]READY FOR SCAVENGING[/]  "
        f"[dim]v{__version__}[/]"
    )
    console.print(
        "  [bold]Commands:[/] [magenta]/exit[/], [magenta]/clear[/], [magenta]/new[/], "
        "[magenta]/sessions[/], [magenta]/load[/], [magenta]/persona[/], "
        "[magenta]/provider[/], [magenta]/models[/], [magenta]/model[/], "
        "[magenta]/cloud[/], [magenta]/pull[/], [magenta]/help[/]"
    )
    console.print()


def print_help() -> None:
    console.print(
        Panel.fit(
            "[yellow]Bandit CLI Commands[/]\n\n"
            "  [magenta]/help[/]              This instruction index\n"
            "  [magenta]/clear[/]             Wipe chat history in the current session\n"
            "  [magenta]/new[/]               Start a new session (saves the current one)\n"
            "  [magenta]/sessions[/]          List saved sessions\n"
            "  [magenta]/load <idx|id>[/]     Resume a saved session\n"
            "  [magenta]/persona <name>[/]    Swap persona (hacker, philosopher, standard)\n"
            "  [magenta]/provider [name][/]   Show/switch backend (ollama default, openai optional)\n"
            "  [magenta]/models[/]            List models for the active provider\n"
            "  [magenta]/model <n|name>[/]    Switch the active model\n"
            "  [magenta]/cloud [name][/]      Browse Ollama cloud catalog (local pull helper)\n"
            "  [magenta]/pull <name>[/]       Download a model via Ollama\n"
            "  [magenta]/temp <val>[/]        Get/set temperature (0.0–2.0)\n"
            "  [magenta]/top_p <val>[/]       Get/set top_p (0.0–1.0)\n"
            "  [magenta]/ctx <val>[/]         Get/set Ollama context size\n"
            "  [magenta]/exit[/]              Quit\n",
            border_style="green",
            title="🦝 help",
        )
    )


def stream_markdown_reply(token_iter) -> str:
    """
    Stream tokens into a live Markdown view.

    Returns the full accumulated assistant text (for saving to the session).
    """
    accumulated = ""
    console.print()
    console.print(Text("Bandit:", style="bold green"), end=" ")
    # Live redraws the markdown as tokens arrive. transient=False keeps
    # the final render on screen when the Live context exits.
    with Live(console=console, refresh_per_second=12, transient=False) as live:
        for token in token_iter:
            accumulated += token
            live.update(Markdown(accumulated))
    console.print()
    return accumulated


def format_size(num_bytes: int) -> str:
    if num_bytes <= 0:
        return ""
    gb = 1024**3
    mb = 1024**2
    if num_bytes >= gb:
        return f"{num_bytes / gb:.1f} GB"
    if num_bytes < mb:
        return ""
    return f"{num_bytes / mb:.0f} MB"
