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
  version "0.2.1"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/BitsOfJT/bandit-ai/releases/download/v0.2.1/bandit"
      sha256 "b3d22ac4c2dd4eb348d02ac19e85c74558cb92a7025d5ec6dd01e6e1e95722ff"
    else
      odie "Bandit only ships an Apple Silicon binary. Build from source: #{homepage}#build-from-source"
    end
  end

  on_linux do
    if Hardware::CPU.intel?
      url "https://github.com/BitsOfJT/bandit-ai/releases/download/v0.2.1/bandit-linux"
      sha256 "e314c4ed838f4f2a1543bec9ecae15cddd7dc750fc5179c058700b99a312fe48"
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
