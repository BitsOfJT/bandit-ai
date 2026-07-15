"""Bandit AI — a cyber-raccoon CLI chatbot.

Package layout (start here when learning the code):

  __main__.py   REPL loop + slash-command dispatch (the "brain")
  config.py     defaults, env vars, theme colors
  session.py    Message/Session dataclasses + JSON save/load
  personas.py   hacker / philosopher / standard system prompts
  render.py     Rich banner + streaming markdown output
  providers/    backends that talk to LLMs
    base.py           shared Protocol (interface)
    openai_provider.py   optional — OpenAI-compatible API
    ollama.py            DEFAULT — local Ollama
    router.py            pick Ollama first, fall back to OpenAI
"""

__version__ = "0.4.0"
