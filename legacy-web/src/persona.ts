// The canonical Bandit persona lives in bandit-soul.md at the repo root. It is
// imported verbatim (Vite ?raw) so the default "hacker" persona IS the full soul
// doc, with no second copy to keep in sync. The Go CLI mirrors this via go:embed.
import banditSoul from '../bandit-soul.md?raw';

export const BANDIT_SOUL = banditSoul.trim();
