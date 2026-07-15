# Homebrew formula for Bandit AI (Python CLI).
#
# Lives in the separate tap repo `homebrew-bandit`
# (github.com/BitsOfJT/homebrew-bandit) as Formula/bandit.rb.
#
#   brew install BitsOfJT/bandit/bandit
#
# After tagging a release, refresh sha256 with:
#   ./packaging/homebrew/update-formula.sh v0.4.0
class Bandit < Formula
  include Language::Python::Virtualenv

  desc "Local-first cyberpunk raccoon chatbot CLI"
  homepage "https://github.com/BitsOfJT/bandit-ai"
  url "https://github.com/BitsOfJT/bandit-ai/archive/refs/tags/v0.4.0.tar.gz"
  sha256 "6665cf2847775a17dae41323c69fd5b560dba0b2b4a4802308f5d5587f06de3c"
  license "MIT"
  head "https://github.com/BitsOfJT/bandit-ai.git", branch: "main"

  depends_on "python@3.13"

  def install
    virtualenv_install_with_resources
  end

  def caveats
    <<~EOS
      Bandit defaults to local Ollama:
        https://ollama.com
        ollama pull gemma4:e2b

      Optional OpenAI-compatible API:
        export OPENAI_API_KEY=...
        then run: bandit
        and switch with /provider openai

      Note: Homebrew core ships an unrelated formula also named "bandit"
      (a Python security linter). Always install this CLI with:
        brew install BitsOfJT/bandit/bandit
    EOS
  end

  test do
    assert_match(/Bandit|Ollama|READY FOR SCAVENGING|Active:/,
                 pipe_output("#{bin}/bandit", "/exit\n"))
  end
end
