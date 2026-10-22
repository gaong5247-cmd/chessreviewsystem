# Review grading model (independent implementation)

This program is not affiliated with Chess.com. It displays distinct visual designs and independently calculated classifications. Our grades are estimates, and they are not guaranteed to match Chess.com, Lichess, En Croissant or Pawn Appétit.

## Public reference methods

- Chess.com Classification V2 (February 9, 2026): Expected Points loss thresholds: Best (exact engine top move), Excellent (0 to 0.02), Good (0.02 to 0.05), Inaccuracy (0.05 to 0.10), Mistake (0.10 to 0.20), Blunder (0.20 and above). Chess.com's mapping is **rating-conditioned and privately calibrated**, unlike this app.
  - https://support.chess.com/en/articles/8572705-how-are-moves-classified-what-is-a-blunder-or-brilliant-etc
- En Croissant: public logistic win chance 100/(1+exp(-0.00368208*cp)); MultiPV to compare second move, with a separate sacrifice detector; report annotation may mark a sacrifice that is the only sound move as !!.
  - https://encroissant.org/docs/guides/analyze-game
- Pawn Appétit is a Rust/Tauri fork of En Croissant, supporting UCI engines and game import:
  - https://github.com/Pawn-Appetit/pawn-appetit

## Algorithm

1. Stockfish 19 searches each **before and after** FEN to the configured min(time, depth, nodes) limit. Each full-game review sends the entire sequence of positions to one engine process. MultiPV 2–5 is used, and all returned scores are normalized to White's perspective.
2. The logistic function maps evaluation to win estimate; expected result is read from the perspective of the side who made the move. Loss is clamped at zero to one.
3. Ordinary classifications use expected points lost: 0.02, 0.05, 0.10, 0.20. An exact engine 1st choice receives Best.
4. Brilliant requires exact top move, a material concession worth at least a minor piece after the engine's best immediate response, no seriously losing resulting position, and no already certain win. It does **not** detect every positional or delayed sacrifice.
5. Great requires the exact top move and the second-best line to be at least 0.10 expected points worse, subject to a non-forced-move and outcome guard.
6. Miss requires failing to exploit a significant previous opponent inaccuracy and a large opportunity to gain a winning position.
7. Known prefixes in the offline opening catalog receive Book. The catalog is intentionally incomplete; PGN header opening names are used as a fallback. Book labels apply only to matched initial moves.
8. Estimated accuracy = average of 100*exp(-2.8*expected_point_loss). This is **not Chess.com's proprietary Accuracy score**. ACPL is an approximate per-move centipawn evaluation loss capped at 1000 for display.

Mate scores are mapped to large signed values to keep the probability model finite. Very low analysis budgets or missing UCI score lines cannot receive an invented grade. Results may vary by machine, Stockfish version, hash, threads, depth and search horizon. Opening references are illustrative and are not a complete ECO database.

## User-configurable limits

- 1–1,000,000 ms for *each analyzed position*
- 1–50 depth
- 1–1,000,000,000,000 nodes
- 1–128 threads; 16–65,536 MB hash
- MultiPV 2–5

The engine accepts combined UCI search limits. First bound reached finishes the current position. Maximum values can take a very long time over a full game. Review can be cancelled.

## Third-party dependencies

Stockfish 19 (GPLv3) is downloaded from the original official-stockfish/Stockfish git repository and built into the Tauri sidecar on release CI. Each release packages the Stockfish COPYING text, and source remains available at https://github.com/official-stockfish/Stockfish/tree/sf_19 . See repository README for source and redistribution rights.
