# Food Sorter phone app

Phone web app for Ethan's food sorter school project (age 8). Take a photo of a food item, an AI gives it a health score from 0 to 10, and the app shows a big 😀 for healthy or 😞 for junk, then tells the ESP8266 sorter board which bin to push it into.

This branch is **Phase 1**: a pretend board on screen stands in for the real one. Real board calls come in Phase 2.

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
