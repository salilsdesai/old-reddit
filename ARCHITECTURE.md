# Old Reddit Chrome Extension — Architecture & Build Plan

## Goal

On `reddit.com` subreddit pages, hide the new Shreddit UI and inject a best-effort recreation of classic old Reddit (dense listings, deep comment trees). Read-only / logged-out only. No redirects to `old.reddit.com`.

## In scope (v1)

| Route | Example |
|-------|---------|
| Subreddit listing | `/r/{sub}`, `/r/{sub}/`, `/r/{sub}/hot`, `/new`, `/rising`, `/top`, `/top/?t=…` |
| Post + comments | `/r/{sub}/comments/{id}/{slug?}/` |

**Out of scope:** home feed, search, profiles, wiki/mod tools, voting, reply, save, login chrome, sidebars, ads.

## Product decisions

1. **Strategy:** Hide new DOM → scrape / fetch data → render old-looking DOM into an injected root.
2. **Visual fidelity:** Best-effort classic look (orange header bar, compact rows, 70px thumbs, blue links, nested comment indent).
3. **Sidebar:** Removed entirely.
4. **Feed loading:** Infinite scroll — append compact rows as new Shreddit posts appear (or via listing JSON `after`).
5. **Expandos:** `[+]` / `[–]` toggles selftext / media under the row (classic behavior).
6. **Comments:** Deep tree by default (~5–6 levels). Mirror old Reddit’s truncation: a ~200-comment budget with `"more"` stubs as “load more comments”, not collapsed `[–]` nodes. Almost all loaded comments render expanded.
7. **Ads:** Stripped (skip `shreddit-ad-post` / promoted).
8. **Hosts:** `reddit.com` / `www.reddit.com` (and `*.reddit.com` matches for the same paths).

## Comment expansion heuristic (from samples)

From `reddit-thread-old.html` (`r/tennis`, ~300 comments):

- ~200 comments rendered; max nesting depth **5** in that save.
- Depth histogram roughly `{0:106, 1:47, 2:30, 3:10, 4:6, 5:1}`.
- **76** `morechildren` stubs — this is how branches stay unexpanded.
- Only **1** UI-collapsed comment; loaded nodes are `noncollapsed`.

So “not all expanded” ≈ Reddit’s server-side budget (limit ≈ 200, depth ≈ 6–10, confidence sort), not client collapse. We reproduce that via:

```
GET /r/{sub}/comments/{id}.json?limit=200&depth=6&raw_json=1&sort=confidence
```

Render `kind: "t1"` nodes nested; render `kind: "more"` as clickable “load more comments” that POSTs `/api/morechildren` (same-origin, logged-out OK).

## High-level architecture

```
┌─────────────────────────────────────────────────────────────┐
│  document_start: hide-new.css + early-hide.js               │
│  Prevent flash of new Shreddit UI                           │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  document_idle: main.js                                     │
│  route = detect(location) → feed | comments | ignore        │
└───────────────┬─────────────────────────────┬───────────────┘
                │                             │
                ▼                             ▼
┌───────────────────────────┐   ┌─────────────────────────────┐
│ FEED                      │   │ COMMENTS                    │
│ 1. scrape shreddit-post   │   │ 1. fetch .json tree         │
│ 2. observe new posts      │   │ 2. scrape OP media fallback │
│ 3. render compact rows    │   │ 3. render OP + nested tree  │
│ 4. expando on demand      │   │ 4. morechildren on click    │
└───────────────────────────┘   └─────────────────────────────┘
                │                             │
                └──────────────┬──────────────┘
                               ▼
                 injected #old-reddit-root
                 (header + content, no side)
```

## Data sources

| Need | Source |
|------|--------|
| Listing posts | Prefer `/r/{sub}/{sort}.json`; fallback: `shreddit-post` attributes + light-DOM slots |
| More listing posts | JSON `after` cursor; plus `MutationObserver` on feed as Shreddit scrolls |
| Comment tree | Prefer `/{permalink}.json?limit=200&depth=6`; fallback: scrape `shreddit-comment` + auto-POST `/svc/shreddit/more-comments/...` partials |
| Load more comments | `POST /api/morechildren` or shreddit more-comments partial (whichever the stub carries) |
| Subreddit name / sort | URL path + query |

Prefer attributes / JSON over piercing shadow DOM. Skip ads (`shreddit-ad-post`, promoted). If `.json` returns 403 in-page, DOM + `/svc/shreddit/*` path is the primary runtime path.

## UI to render

### Shell (both pages)
- Classic `#header`: Reddit logo mark, subreddit name link, tabmenu (`hot | new | rising | top | controversial`).
- Logged-out header-right omitted / minimal.
- **No** `div.side` sidebar.
- `#old-reddit-root` replaces visible page; original Shreddit kept in DOM but hidden (so their loaders can still fill the feed for scraping).

### Feed row (per post)
Classic structure: rank | midcol score | 70×70 thumbnail | title + domain | expando button | tagline (time · by author) | “N comments”.

Expando:
- **text:** show selftext markdown/HTML from scraped body or JSON.
- **image/gallery:** show image(s) under row.
- **video:** show `<video>` / reddit video poster + src when available; else link out.
- Collapsed by default.

### Comments page
- OP as expanded `thing.link` (title, score, author, body/media).
- `div.sitetable.nestedlisting` of `thing.comment` with `.child` nesting.
- Tagline: `[–]` collapse toggle (client-only), author, score, time, `(N children)`.
- `morechildren` stubs for truncated branches.

## File layout

```
extension/
  manifest.json
  content/
    early-hide.js          # document_start
    main.js                # boot + routing
    router.js
    api.js                 # .json + morechildren helpers
    scrape-feed.js
    time.js                # relative timestamps
    render-shell.js
    render-feed.js
    render-comments.js
    expando.js
  styles/
    hide-new.css           # document_start hide
    old-reddit.css         # classic look
  icons/                   # simple placeholder icons
ARCHITECTURE.md
README.md
```

## Build steps

1. Write this plan ✅
2. Scaffold `extension/manifest.json` (MV3) + early hide CSS/JS
3. Shell + old-reddit CSS (listing + comments density)
4. Feed scrape → render → infinite scroll observer → expandos
5. Comments JSON fetch → deep render → morechildren + collapse toggles
6. Wire router; ignore unsupported `/r/…` paths (wiki, etc.)
7. Smoke-check against sample-page structure / manual load instructions in README

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Shreddit markup / attrs change | Isolate scrape behind helpers; attrs are stabler than shadow internals |
| `.json` blocked / 403 | Fetch from page context (user cookies); fallback: deepen via `/svc/shreddit/more-comments` HTML partials |
| FOUC of new UI | `document_start` CSS hide + early JS |
| Duplicate posts in SSR HTML | Dedupe by `post-id` / `t3_` |
| Media URL oddities | Best-effort; link to permalink if media can’t expand |

## Non-goals (explicit)

Redirects, old.reddit fallback, login/vote/reply, sidebar parity, pixel-perfect CSS clone of every old stylesheet, search/profiles/home.
