# The Captain's Chronometer

A fully offline, vintage pirate-themed multi-clock built with plain HTML, CSS and vanilla JavaScript. No frameworks, no CDNs, no image files, and no network requests at runtime.

## Instruments

- **Master controls:** Start, Pause, Reset. Nothing runs until Start is pressed. Keyboard: `Space` starts or pauses, `R` resets (when focus is not in a text field or on a button).
- **Seconds clock:** elapsed time as `HH:MM:SS` on a brass plaque, plus an analog dial with a sweeping second hand, a minute hand and an hours sub-dial.
- **Ship's wheel:** the centerpiece; it turns slowly while the chronometer runs.
- **Tally meter:** an odometer with rolling digit wheels that advances by exactly 1 per elapsed second.
- **Microsecond counter:** elapsed microseconds driven by `performance.now()` and `requestAnimationFrame`. Browsers round high-resolution timers, so the app measures the timer step on load and visually interpolates only the digits finer than that step (shown dotted). A footnote on the page explains this.
- **Hourglass:** set minutes and seconds, turn the glass, watch the sand fall, and hear an alarm at zero.
- **Ship's bell:** an optional chime every 30 minutes of sailing (elapsed) time, using the traditional count of one to eight bells. Synthesized with the Web Audio API. Includes a chimes on/off toggle, a mute toggle for all sounds, and a test strike.

All timing comes from timestamps (`performance.now()`, with `Date.now()` used to catch device sleep), never from counted `setInterval` ticks, so it stays accurate when a tab is throttled.

Respects `prefers-reduced-motion`: the wheel stops turning, and the candle flicker and decorative animations are disabled.

## Project structure

```
captains-chronometer/
  index.html
  css/style.css
  js/app.js
  fonts/              Pirata One, Cinzel Decorative, IM Fell English (woff2)
  manifest.json
  service-worker.js
  README.md
```

Fonts come from the npm packages `@fontsource/pirata-one`, `@fontsource/cinzel-decorative` and `@fontsource/im-fell-english` (SIL Open Font License) and are loaded with `@font-face` using relative paths.

## Run locally

The service worker needs `http://localhost` or HTTPS (it will not run from a `file://` URL, though the app itself still works when opened directly).

From inside the `captains-chronometer` folder, run one of:

```bash
python3 -m http.server 8080
# or
npx serve .
```

Then open <http://localhost:8080>.

## Test offline

1. Open the app at `http://localhost:8080` once so the service worker installs.
2. In Chrome or Edge, open DevTools, go to **Application > Service Workers**, and confirm it is activated. **Application > Cache Storage** should list every file, including the five fonts.
3. In the **Network** tab, choose **Offline** (or stop the local server) and reload. The app should load completely, fonts included.

## Deploy on GitHub Pages

1. Create a new repository on GitHub (for example `captains-chronometer`).
2. Upload the **contents** of this folder (so `index.html` sits at the repository root) and commit to the `main` branch.
3. Go to **Settings > Pages**. Under **Build and deployment**, set **Source** to **Deploy from a branch**, choose **main** and **/ (root)**, then **Save**.
4. After a minute or two the site is live at `https://<your-username>.github.io/captains-chronometer/`.

Every path is relative, so the app works under the repository subpath without changes.

## Updating

When you change any file, bump `CACHE_VERSION` in `service-worker.js` (for example `captains-chronometer-v2`) so returning visitors receive the new files.
