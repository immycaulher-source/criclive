# NPL Live Score

Cricket live score website for the Nepal Premier League 2026. Zero-dependency Node.js server (Node 18+).

## Run

```
node server.js
```

Then open http://localhost:3000

## Folder structure

```
CRIC/
├── server.js            Node server: pages, RSS articles, optional Cricbuzz API, SEO files
├── package.json
├── .env                 Secrets and settings (never commit; listed in .gitignore)
├── .gitignore
├── README.md
├── pages/               HTML pages
│   ├── index.html       Home: banner, live/upcoming cards, points table, news slider
│   ├── fixtures.html    /fixtures       All 32 matches, team filter, results
│   ├── points-table.html /points-table  Standings and how the points system works
│   ├── live-streams.html /live-streams  Where to watch (TV, streaming)
│   └── tickets.html     /tickets        How to buy tickets
└── public/
    ├── ads.txt          Google AdSense file, served at /ads.txt
    └── images/          Banners and the schedule poster, served at /<filename>
        ├── banner2.jpeg
        ├── banner3.jpeg      Banner used on the pages
        ├── schedule.jpg      Official Season 3 schedule poster
        ├── sd.jpeg
        └── news23-....jpg
```

## .env settings

| Setting | What it does |
|---|---|
| `USE_CRICBUZZ` | `true` turns the Cricbuzz API on. Off by default (no API calls). |
| `RAPIDAPI_KEY`, `RAPIDAPI_HOST` | API credentials (only used when `USE_CRICBUZZ=true`) |
| `SITE_URL` | Your real domain, e.g. `https://example.com`. Used in canonical links, sitemap, robots.txt |
| `PORT` | Server port (default 3000) |
| `SERIES_FILTER` | Only show API matches whose series name contains this text |
| `LIVE_MS`, `LIST_MS`, `NEWS_MS`, `RSS_MS` | Cache times in milliseconds |

## Where to edit things

- Banner, nav, upcoming-match cards, points table data (`TEAMS`): `pages/index.html`
- Points table data is also in `pages/points-table.html` (`TEAMS`). Update both when results come in.
- Match results: `RESULTS` list at the bottom of `pages/fixtures.html`
- RSS feeds: `FEEDS` list in `server.js`
- To add an image, drop it in `public/images/` and use it as `/<filename>` in the HTML.
