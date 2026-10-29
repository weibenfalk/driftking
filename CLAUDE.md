# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` – Vite dev server
- `npm run build` – `tsc -b` typecheck, then production build to `dist/`
- `npm run lint` – ESLint
- No test runner is configured.

## Architecture

Standalone top-down drift racer (React 19 + Vite + TypeScript) rendered to a fixed 320×200 canvas in 80s Amiga pixel-art style. Extracted from "Pixelpenta", so the engine layer mimics that project's game-host API.

- `src/App.tsx` – thin React shell. Owns the `<canvas>`, starts a race in an effect (re-run via the `run` counter for "Race again"), and shows the finish overlay. The race result is a raw score in hundredths of a second (`formatTime(raw / 100)`).
- `src/engine/host.ts` – `startRace()` is a minimal stand-in for Pixelpenta's GameHost. It builds a `GameApi` (see `engine/types.ts`) and passes it to a `CreateGame` function. The api provides canvas/ctx, `input`, `audio`, `setScore`/`setStatus`, `loop(update, draw)` (dt clamped to 50ms, update skipped while paused), `listen` and `onCleanup` (auto-removed on teardown), and `end()` (250ms delay, then `onEnd`). There is no countdown, pause menu or points system in the host. The race handles those itself.
- `src/engine/` also holds `input.ts` (keyboard state), `audio.ts` (a shared singleton `audio`, unlocked on start), `pixelfont.ts`, and `util.ts`.
- `src/race/` – the game, split by concern. `createGame(api, track)` in `race.ts` returns a `GameInstance`.
  - `track.ts` – the `Track` type (control points `cp`, world size, laps, road width, trees, optional lake, colour `Theme`) and `buildWorld(track)`, which turns it into a `World`: a Catmull-Rom centre line sampled every 4px (`S`, with tangent/normal), per-sample road half-width `hw` (wider in corners) and AI target speed `aiSpd`, a pre-painted bitmap, a `surf` byte map (`GRASS`/`ASPHALT`/`CURB`/`SOLID`/`WATER`) used for collision, trees and a minimap. `getWorld(track)` caches one world per track id for the page lifetime. Also `surfAt`, `nearestIdx` (windowed search, cheap per-frame) and `globalIdx` (full scan, for resets).
  - `tracks.ts` – the `TRACKS` list. **To add a track, add an entry here**; nothing else needs to change (App's picker and `?track=<id>` read this list). Point 0 of `cp` is the start line and the road behind it must be straight for ~90px (grid), with free ground on the left of travel for the grandstand. Keep parallel sections of road ≥ ~130px apart.
  - `car.ts` – `Car`, sprite sets (`getLooks`, 64 rotation frames per car plus shadows), `createGrid`, player physics `drive`, `moveCar` (walls/trees) and `collideCars`. Hits are reported through the `Env` hooks (`bump`, `treeHit`), so physics never touches race state.
  - `ai.ts` – `aiDrive`: lane-wandering pursuit of the centre line with rubber-banding to the player. A finished player is switched to `ai` with skill 0 so the car rolls to a stop.
  - `render.ts` – `createRenderer(ctx, world)` owns a private copy of the track bitmap (skid marks are painted onto it) and draws world, particles, cars, minimap and HUD text from a `View`. Also exports `SW`/`SH` (320×200).
  - `race.ts` – orchestration only: lap/position tracking, off-track recovery, drift-chain scoring (final raw score is time minus drift bonus, in 1/100 s), engine sound, camera.

Track picker in the UI (bottom left); `?track=<id>` selects a track on load.

Controls: arrows/WASD to steer, Space for the handbrake.
