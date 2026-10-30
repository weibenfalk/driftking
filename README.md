# Drift King

Standalone top-down drift racer in 80s Amiga pixel-art style (320×200 canvas), extracted from Pixelpenta.

- `npm run dev` – dev server
- `npm run build` – typecheck and production build

Layout: `src/engine/` (input, audio, pixel font, host loop), `src/race/` (the race), `src/App.tsx` (React shell).
Keys: arrows/WASD to steer, SPACE handbrake.

Share image: `public/og.png` (1200x630) is made by `tools/og.html`, a scene drawn with the game's own code (see the comment at the top of that file for how to render it again). The Open Graph tags in `index.html` need an absolute image address, so build with `VITE_SITE_URL=https://your.domain npm run build`; without it the address is relative.
