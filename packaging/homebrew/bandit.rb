# Homebrew formula for Bandit AI.
#
# This file belongs in a SEPARATE tap repo named `homebrew-bandit`
# (github.com/BitsOfJT/homebrew-bandit), at Formula/bandit.rb. Once it is
# published there, users install with:
#
#   brew install BitsOfJT/bandit/bandit
#
# Regenerate on each release with packaging/homebrew/update-formula.sh.
class Bandit < Formula
  desc "Local-first AI chatbot CLI with a retro cyberpunk aesthetic"
  homepage "https://github.com/BitsOfJT/bandit-ai"
  version "0.2.0"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/BitsOfJT/bandit-ai/releases/download/v0.2.0/bandit"
      sha256 "0c1a633378ca469590f36bc82cdc0b57503266dde3cd8d855dad63b612e67cfb"
    else
      odie "Bandit only ships an Apple Silicon binary. Build from source: #{homepage}#build-from-source"
    end
  end

  on_linux do
    if Hardware::CPU.intel?
      url "https://github.com/BitsOfJT/bandit-ai/releases/download/v0.2.0/bandit-linux"
      sha256 "0d3d79f884569ff46f6429f8a750b34cd7de1291a967ea35875e99dd886ce427"
    else
      odie "Bandit only ships an amd64 Linux binary. Build from source: #{homepage}#build-from-source"
    end
  end

  def install
    if OS.mac?
      bin.install "bandit"
    else
      bin.install "bandit-linux" => "bandit"
    end
  end

  def caveats
    <<~CAVEATS
      Bandit needs Ollama running locally before it can chat:
        https://ollama.com

      Then pull a model, e.g.:
        ollama pull gemma4:e2b
    CAVEATS
  end

  test do
    assert_match "Bandit", pipe_output("#{bin}/bandit", "/exit\n")
  end
end
