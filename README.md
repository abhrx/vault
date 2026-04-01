# Vault

**Your Personal Cinema**: a slick, static web app for discovering movies, TV shows, and anime, then playing them via selectable embed sources. Metadata comes from **TMDB**, and your **watchlist/history live in your browser**.

**Entry points**
- Landing page: `htdocs/index.html`
- Main app: `htdocs/vault/index.html`

---

## Features

- **Trending**: day/week lists
- **Search**: all, movies, TV
- **Genre filters**
- **Watchlist + history**: saved in `localStorage`
- **Featured hero** on the home screen
- **Multiple playback sources**: switch any time
- **Anime support**: Jikan (MyAnimeList) lookup to help pick sub/dub style embeds
- **Clean URLs + caching** when hosted on Apache via `.htaccess`

---

## Project structure

```text
vault/
├─ README.md
└─ htdocs/
   ├─ .htaccess
   ├─ index.html              # landing page (links into /vault)
   ├─ app.js                  # landing page logic (TMDB backdrop + search handoff)
   ├─ elements.css            # Nekoweb sitebox styling (hosting-specific)
   ├─ err/                    # custom error pages (Apache)
   │  ├─ 400.html 401.html 403.html 404.html 503.html
   └─ vault/                  # main app
      ├─ index.html
      ├─ style.css
      ├─ app.js               # main app logic
      ├─ config.js            # runtime config (defaults, maintenance, notification)
      ├─ watchlist.html
      ├─ history.html
      ├─ settings.html
      ├─ contact.html
      ├─ maintenance.html
      └─ vault-logo.png
```

---

## Quick start (local)

### Option A: simple local server (fastest)

This runs the site, but **Apache-only features** (like clean-URL rewrites) will not apply.

```bash
cd htdocs
python -m http.server 8080
```

Then open:
- `http://localhost:8080/` (landing)
- `http://localhost:8080/vault/` (app)

### Option B: Apache (recommended)

Use Apache (XAMPP/WAMP/your own) and point the DocumentRoot to `vault/htdocs`.

This enables:
- `.htaccess` **clean URLs** (removes `.html`)
- header-based **cache control**
- custom **error pages**

---

## Configuration

### TMDB API key (required for metadata)

There is a `TMDB_KEY` constant in:
- `htdocs/index.html` (landing backdrop + search redirect)
- `htdocs/vault/app.js` (main app)

Replace it with your own TMDB API key (create one in TMDB account settings).

### Site config (`vault/config.js`)

Runtime toggles live in `htdocs/vault/config.js` via `window.siteConfig`, including:
- **defaultServer**: default playback source ID
- **maintenance**: show maintenance mode
- **heroOverride / heroType**: tweak the featured hero
- **notification**: optional toast-style announcement

---

## Notes on data + storage

- **Watchlist**: stored in `localStorage` under `vault_watchlist`
- **History**: stored in `localStorage` under `vault_history`
- Clearing site data in your browser will reset both.

---

## Deploy

This is a static site, so you can deploy it anywhere that serves HTML/CSS/JS.

- **Best experience**: Apache hosting with `.htaccess` support (clean URLs + caching rules).
- **Static hosts** (no `.htaccess`): still works, but you should link to the explicit `.html` pages (or configure redirects/rewrites on that platform).

---

## Troubleshooting

- **Blank posters / metadata not loading**: verify your `TMDB_KEY` is valid and not being blocked by the browser/network.
- **Clean URLs not working** (e.g. `/vault/settings` 404s): you’re not running behind Apache with `mod_rewrite`, or `.htaccess` isn’t enabled.
- **Playback doesn’t load**: embed providers can be region-blocked or down; switch sources in-app.

---

## Disclaimer

This project uses third-party APIs and embeds. You are responsible for complying with the terms of service of:
- TMDB (metadata)
- Any embed/playback providers you enable
- Your hosting platform

