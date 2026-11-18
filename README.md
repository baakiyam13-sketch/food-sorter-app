# Food Sorter phone app

Phone web app for Ethan's food sorter school project (age 8). Take a photo of a food item, an AI gives it a health score from 0 to 10, and the app shows a big 😀 for healthy or 😞 for junk, then tells the ESP32 sorter board which bin to push it into.

**Phase 1** is a pretend board on screen. **Phase 2** (this branch) adds the real ESP32 board over **Bluetooth Low Energy**, so the phone only needs the internet for the AI call and needs no Wi-Fi link, IP address or `.local` name for the board. The firmware is in the `microcontroller-projects` repository, folder `esp32/food-sorter`, which also documents the command protocol.

## Using the real board

1. Flash the ESP32 with `esp32/food-sorter` and power it on.
2. Open the deployed app in **Chrome on an Android phone** (Web Bluetooth needs Chrome and HTTPS; iPhones are not supported). Keep Bluetooth on, and Location on for Android's Bluetooth scan.
3. Settings, Board mode, **Real board (Bluetooth)**, tap **Connect board**, choose `food-sorter`, then **Save**.
4. Scan as usual. If the link drops, the app reconnects to the same board by itself before the next scan, or tap Connect board again.

The UUIDs in `src/ble.ts` must match `esp32/food-sorter/src/config.h`.

## Stack

Vite + React + TypeScript, plain CSS, hosted on Netlify. One Netlify Function (`netlify/functions/score.ts`) calls Google Gemini; the API key stays on the server and the browser never sees it. No database, no accounts — the scan log lives in localStorage.

## Run it

```bash
npm install
npm run dev      # the app (the score function only runs when deployed on Netlify)
npm test         # unit tests (Vitest)
npm run build    # type-check + production build
```

## Deploy

1. Connect this repo to a new Netlify site (it picks up `netlify.toml` by itself).
2. In the Netlify site settings, add the environment variable `GEMINI_API_KEY`. Never put it in the repo.
3. Optional: set `GEMINI_MODEL` to override the default free-tier Gemini Flash model.
4. Redeploy.
