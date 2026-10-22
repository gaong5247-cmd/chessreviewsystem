# Chess Review System

A desktop-first, locally analyzed chess game reviewer built with Rust, Tauri 2, React and Stockfish 19.

Features:
- Paste PGN, open local PGN, import public Lichess game links or Lichess / Chess.com player games.
- Review every move with Best, Excellent, Good, Inaccuracy, Mistake, Blunder, plus evidence-checked Brilliant, Great and Miss.
- Per-move eval, engine best-move arrows, MultiPV candidates, annotated move list, evaluation graph and player accuracy estimates.
- Configure time per position from 1 to 1,000,000 milliseconds, depth 1–50, nodes 1–1,000,000,000,000, threads, hash and MultiPV.
- Distinctive dark chess board design; no Chess.com logo or proprietary artwork.
- Local Stockfish 19 sidecar compiled and embedded in each downloadable installer.
- Automatically build Windows, Linux and macOS packages and publish a GitHub Release on changes to main.

## Running locally

Install Node.js 20+, Rust stable, and your platform's Tauri 2 prerequisites.

    npm install
    npm run icons
    npm run tauri dev

Local development also needs a Stockfish executable installed on your PATH, or a custom path in Settings. Packaged releases embed Stockfish.

## Release

GitHub Actions runs on every push to main and on manual dispatch. If all OS builds succeed, the release becomes public. See the workflow in .github/workflows/release.yml. The project is not affiliated with Chess.com, Lichess, En Croissant or Pawn Appétit.

## Move grading

Our calculations are independent reproductions of public ideas, NOT Chess.com's proprietary implementation. Expected-score cutoffs follow publicly documented buckets (0/2/5/10/20 percentage point loss) while expected score is estimated with a public logistic function; Chess.com's full rating-conditioned expected-points model is not published. Special grades are heuristic and deliberately conservative.

See docs/GRADING.md for details.

## License

Application source is offered under GPL-3.0-or-later. Stockfish is licensed under GPLv3; builds include its COPYING and source link. Chess.com remains the owner of its trademarks, UI artwork and other IP.
