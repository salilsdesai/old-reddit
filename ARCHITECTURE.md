# Old Reddit Chrome Extension — Architecture

## Goal

On `reddit.com` subreddit pages, hide the new Shreddit UI and inject a best-effort recreation of classic old Reddit (dense listings, deep comment trees). Read-only / logged-out only. No redirects to `old.reddit.com`.

## In scope

| Route | Example |
|-------|---------|
| Subreddit listing | `/r/{sub}`, `/r/{sub}/`, `/r/{sub}/hot`, `/new`, `/rising`, `/top`, `/controversial`, `/top/?t=…` |
| Post + comments | `/r/{sub}/comments/{id}/{slug?}/` (optional `?sort=`) |

**Out of scope:** home feed, search, profiles, wiki/mod tools, voting, reply, save, login/signup chrome, sidebars, ads.

## Product decisions (as built)

1. **Strategy:** Hide new DOM → scrape / fetch data → render old-looking DOM into `#old-reddit-root`.
2. **Visual fidelity:** Best-effort classic look (orange header mark, compact flex listing rows, 54px thumbs, blue links, nested comment indent). Screenshots in `screenshots/`.
3. **Sidebar:** Removed entirely.
4. **Feed loading:** Infinite scroll via listing JSON `after`, plus `MutationObserver` on hidden Shreddit posts, plus delayed `/svc/shreddit/community-more-posts` thumbnail enrichment.
5. **Expandos:** `[+]` / `[–]` toggles selftext / media under the row (collapsed by default on listings).
6. **Comments:** Deep tree by default (~6 levels). Server budget (~200 comments) leaves `"more"` stubs as “load more comments”. Loaded comments render expanded; `(N children)` only shows when a comment is collapsed.
7. **Ads:** Stripped (`shreddit-ad-post` / promoted skipped).
8. **Hosts:** `reddit.com` / `www.reddit.com` / `*.reddit.com` for `/r/*` paths.

## Comment expansion heuristic

From the old-Reddit sample (`reddit-thread-old.html`): ~200 comments, max depth ~5–6, many `morechildren` stubs, almost no UI-collapsed nodes.

“Not all expanded” means Reddit’s server-side budget (`limit≈200`, `depth≈6`, confidence sort), not client collapse. Primary fetch:

```
GET /r/{sub}/comments/{id}.json?limit=200&depth=6&raw_json=1&sort=…
```

`kind: "more"` stubs expand on click via (in order):

1. Shreddit `faceplate-partial` POST to `/svc/shreddit/more-comments/...` **with the hidden `cursor` form field**
2. `POST /api/morechildren`
3. Comment-branch JSON `/r/{sub}/comments/{post}/_/{comment}.json`
4. `GET /svc/shreddit/comment/t1_…?depth=…`

## High-level architecture

```
┌─────────────────────────────────────────────────────────────┐
│  document_start: hide-new.css + early-hide.js               │
│  Visually park Shreddit off-screen (still runnable)         │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  document_idle: main.js                                     │
│  route = detect(location) → feed | comments | ignore        │
│  SPA: patched pushState/replaceState + popstate + poll      │
└───────────────┬─────────────────────────────┬───────────────┘
                │                             │
                ▼                             ▼
┌───────────────────────────┐   ┌─────────────────────────────┐
│ FEED                      │   │ COMMENTS                    │
│ 1. listing .json          │   │ 1. comments .json           │
│ 2. shreddit listing HTML  │   │ 2. DOM scrape + deepen      │
│ 3. observe shreddit-post  │   │ 3. attach more-cursors      │
│ 4. compact rows + expando │   │ 4. OP + tree + load-more    │
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
| Listing posts | `/r/{sub}/{sort}.json`; fallback DOM `shreddit-post`; enrich via `/svc/shreddit/community-more-posts/{sort}/` |
| Thumbnails | JSON `thumbnail` / `preview` / `media_metadata` / oembed / crosspost; DOM imgs (incl. open shadow, srcset, lazy-src); player `poster` |
| More listing posts | JSON `after`; MutationObserver; scroll bridge nudges hidden Shreddit |
| Comment tree | `.json?limit=200&depth=6`; fallback scrape `shreddit-comment` + auto-fetch more-comments partials (`cursor` required) |
| Load more comments | Partial+cursor → morechildren → comment-branch JSON → shreddit single-comment HTML |
| Subreddit / sort / time | URL path + `?t=` (top) + `?sort=` (comments) |

Prefer attributes / JSON over shadow piercing, but listing thumbnails do walk open shadow roots when needed. Skip ads.

## UI (current)

### Shell
- **Feed:** logo mark, `r/{sub}` link, tabmenu (`hot | new | rising | controversial | top`). On **top**, a “links from” time-range dropdown.
- **Comments:** logo + subreddit link only (no hot/new/… tabs). Sort dropdown sits under “all N comments”.
- No login/signup chrome, no sidebar.
- Shreddit stays in the DOM but is visually hidden so its loaders can still run.

### Feed row
Flex row: rank | score midcol | **54×54** thumbnail | title (no domain suffix) | expando | tagline | “N comments”.

### Comments page
- OP with classic blue-bordered selftext box when text.
- Nested `thing.comment` with floated vote midcol beside tagline/body.
- `[–]` / `[+]` collapse; `(N children)` hidden unless collapsed.
- Equal vertical rhythm: ~12px between root siblings and between parent → child (`.child { margin-top: 12px }`).
- “load more comments” is a plain blue link (no button chrome / gray highlight).

## File layout

```
extension/
  manifest.json                 # MV3 content scripts + host permissions
  content/
    early-hide.js               # document_start route gate + pending class
    main.js                     # boot, SPA navigation, route keys
    router.js                   # feed | comments | ignore
    api.js                      # JSON listing/comments, morechildren,
                                # shreddit listing, comment-branch, normalize*
    scrape-feed.js              # collect/observe shreddit-post
    scrape-comments.js          # comment DOM parse, partial+cursor fetch,
                                # deepenForest, attachDomPartialsToMores
    time.js                     # relative timestamps
    expando.js                  # listing expand/collapse media/text
    render-shell.js             # header / menus / #old-reddit-root
    render-feed.js              # listing mount + infinite scroll
    render-comments.js          # OP + tree + load-more
  styles/
    hide-new.css                # park Shreddit; show #old-reddit-root
    old-reddit.css              # classic look
  icons/
screenshots/                    # README screenshots (home / post)
sample-pages/                   # saved old vs new HTML references
ARCHITECTURE.md
README.md
```

## Runtime notes

- **FOUC:** `old-reddit-pending` at `document_start`; `old-reddit-active` once the root mounts. Shreddit is positioned off-screen (not `display:none`) so JS/network can continue.
- **Dedupe:** posts keyed by `t3_…`; later enrich passes only fill missing thumbnails.
- **SPA:** `history.pushState` / `replaceState` wrapped; `popstate` + 1s path poll remount when the route key changes.
- **Unsupported `/r/…` paths** (wiki, about, search, …): early-hide and router both no-op; new Reddit shows normally.

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Shreddit markup / attrs change | Scrape helpers isolated; attrs preferred over shadow internals |
| `.json` 403 | Page-context cookies; DOM + `/svc/shreddit/*` fallbacks |
| more-comments empty without cursor | Capture/POST `cursor` from `faceplate-partial` |
| Missing thumbs on some subs | Multi-source normalize + shreddit listing enrich + delayed DOM rescrape |
| Feed flex CSS breaking comment midcol | Listing flex rules scoped to `.thing.link`; comments keep floated midcol |

## Non-goals (explicit)

Redirects, `old.reddit.com` fallback, login/vote/reply, sidebar parity, pixel-perfect clone of every old stylesheet, search/profiles/site home.
