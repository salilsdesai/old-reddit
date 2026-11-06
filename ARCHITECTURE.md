# Old Reddit Chrome Extension — Architecture

## Goal

On `reddit.com` subreddit pages, hide the new Shreddit UI and inject a best-effort recreation of classic old Reddit (dense listings, deep comment trees). Read-only / logged-out only. No redirects to `old.reddit.com`.

## In scope

| Route | Example |
|-------|---------|
| Subreddit listing | `/r/{sub}`, `/r/{sub}/`, `/r/{sub}/hot`, `/new`, `/rising`, `/top`, `/controversial`, `/top/?t=…` |
| Post + comments | `/r/{sub}/comments/{id}/{slug?}/` (optional `?sort=`) |
| Focused comment | `/r/{sub}/comments/{id}/comment/{commentId}/` (and `/r/{sub}/comments/{id}/{slug}/{commentId}/`) |

**Out of scope:** home feed, search, profiles, wiki/mod tools, voting, reply, save, login/signup chrome, sidebars, ads.

## Product decisions (as built)

1. **Strategy:** Hide new DOM → scrape / fetch data → render old-looking DOM into `#old-reddit-root`.
2. **Visual fidelity:** Best-effort classic look (orange header mark, compact flex listing rows, 54px thumbs, blue links, nested comment indent). Screenshots in `screenshots/`.
3. **Sidebar:** Removed entirely.
4. **Feed loading:** Infinite scroll via listing JSON `after`, plus `MutationObserver` on hidden Shreddit posts, plus delayed `/svc/shreddit/community-more-posts` thumbnail enrichment.
5. **Expandos:** `[+]` / `[–]` toggles selftext / media under the row (collapsed by default on listings). Feed titles go to the media/source URL; comments are only via the comments link.
6. **Comments:** Mirror default Reddit loading, restyled. Do **not** rebuild the tree from `comments.json` / `/api/morechildren` (wrong parents and duplicates). Scrape the live Shreddit comment tree; load more the same way Shreddit does.
7. **Ads:** Stripped (`shreddit-ad-post` / promoted skipped).
8. **Hosts:** `reddit.com` / `www.reddit.com` / `*.reddit.com` for `/r/*` paths.

## Comment loading (matches native Shreddit)

Shreddit does **not** dump the full thread. It serves:

1. An initial `shreddit-comment` forest.
2. Nested **`faceplate-partial.more-comments-partial`** buttons: `POST /svc/shreddit/more-comments/{sub}/{postId}?sort=…` with a hidden `cursor` (and `startingDepth` / `commentParentPositions`). Count comes from `faceplate-number` or `comments-remaining=`.
3. A **top-level** `#top-level-more-comments-partial` (`loading="lazy"`, `top-level=1`) for infinite-scroll root comments; after that, a leftover “View more comments” / load-more stub.
4. At max depth, **continue-thread** links: `a.more-comments-link[slot="children"]` whose `href` is the parent comment permalink (`/r/{sub}/comments/{post}/comment/{id}/?force-legacy-sct=1`). These do **not** expand in place. They open a focused comment page (same as **permalink**). Duplicate `.fold-more` / `slot="more-comments-permalink"` links are ignored.

The overlay labels every stub `load more comments (N replies)`. In-thread partials POST and splice HTML into the tree. Continue-thread stubs are real `<a href>` navigations to the focused comment URL.

`api.js` still has `fetchComments` / `fetchMoreChildren` / `fetchCommentBranch` (JSON). Comments UI uses JSON only to refresh OP metadata (`limit: 1`). The tree is `forestFromNative()`.

## High-level architecture

```
┌─────────────────────────────────────────────────────────────┐
│  document_start: hide-new.css + early-hide.js               │
│  Shreddit stays in-viewport, opacity 0 (observers still run)│
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  document_idle: main.js                                     │
│  route = detect(location) → feed | comments | ignore        │
│  SPA: patched pushState/replaceState + popstate + 1s poll   │
│  Overlay /comments/ clicks → full load (not Reddit SPA)     │
└───────────────┬─────────────────────────────┬───────────────┘
                │                             │
                ▼                             ▼
┌───────────────────────────┐   ┌─────────────────────────────┐
│ FEED                      │   │ COMMENTS                    │
│ 1. listing .json          │   │ 1. wait for shreddit-comment│
│ 2. shreddit listing HTML  │   │ 2. scrape forest + stubs    │
│ 3. observe shreddit-post  │   │ 3. OP from shreddit-post    │
│ 4. compact rows + expando │   │ 4. partial POST / continue  │
│                           │   │    link / permalink nav     │
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
| Comment tree | Live `shreddit-comment` (un-nested elements are roots, including focused pages where `depth` is not 0) |
| Load more (in thread) | `POST` more-comments partial **with `cursor`**; parse returned `shreddit-comment` HTML |
| Load more (root scroll) | `#top-level-more-comments-partial`; auto-click when near viewport |
| Continue deep chain | `a.more-comments-link[slot=children]` → focused comment URL |
| OP post | `shreddit-post`; optional comments `.json` for title/score/count |
| Subreddit / sort / time / focus | URL path + `?t=` (top) + `?sort=` (comments) + `/comment/{id}/` |

Prefer attributes / JSON over shadow piercing, but listing thumbnails do walk open shadow roots when needed. Skip ads.

## Navigation

Reddit’s SPA hijacks same-origin `<a>` clicks. While Shreddit is hidden, that path often never hydrates comments (stuck on “Loading comments…” until refresh).

`main.js` capture-phase handler on `#old-reddit-root a[href]` matching `/r/…/comments/…`:

- `preventDefault` even if Reddit already handled the click (`document_idle` runs after Reddit’s capture listener).
- `location.href` to the path (normalize `www.reddit.com`).
- Focused comment URLs get `?force-legacy-sct=1`.
- If pathname is already the dest (SPA `pushState` + `scrollIntoView` of the hidden comment), **`location.reload()`** so SSR serves the focused branch.

`routeKey` for comments is `comments:{sub}:{postId}:{focusCommentId}:{sort}` so permalink / continue-thread remounts the overlay.

## UI (current)

### Shell
- **Feed:** logo mark, `r/{sub}` link, tabmenu (`hot | new | rising | controversial | top`). On **top**, a “links from” time-range dropdown.
- **Comments:** logo + subreddit link only (no hot/new/… tabs). Sort dropdown sits under “all N comments”.
- No login/signup chrome, no sidebar.
- Shreddit stays in the DOM, `position:fixed; inset 0; opacity:0` so IntersectionObservers and comment hydration still run. Do not park it at `left:-10000px`.

### Feed row
Flex row: rank | score midcol | **54×54** thumbnail | title (media URL for link/video posts) | expando | tagline | “N comments”.

### Comments page
- OP with classic blue-bordered selftext box when text.
- Nested `thing.comment` with floated vote midcol beside tagline/body.
- `[–]` / `[+]` collapse; `(N children)` in the tagline, hidden with CSS unless collapsed.
- “load more comments (N replies)” is a plain blue link (no button chrome).
- Continue-thread and permalink both open `/r/{sub}/comments/{post}/comment/{id}/`.

## File layout

```
extension/
  manifest.json                 # MV3 content scripts + host permissions
  content/
    early-hide.js               # document_start route gate + pending class
    main.js                     # boot, SPA nav, overlay comment clicks
    router.js                   # feed | comments (focusCommentId) | ignore
    api.js                      # listing JSON, shreddit listing, post/video
                                # normalize; unused comment-JSON helpers remain
    scrape-feed.js              # collect/observe shreddit-post
    scrape-comments.js          # native forest, partial+cursor, continue links
    time.js                     # relative timestamps
    expando.js                  # listing expand/collapse media/text
    render-shell.js             # header / menus / #old-reddit-root
    render-feed.js              # listing mount + infinite scroll
    render-comments.js          # OP + tree + load-more / continue-thread
  styles/
    hide-new.css                # in-viewport hide; show #old-reddit-root
    old-reddit.css              # classic look
  icons/
pages/                          # saved native vs overlay HTML (debug)
screenshots/                    # README screenshots (home / post)
ARCHITECTURE.md
README.md
```

## Runtime notes

- **FOUC:** `old-reddit-pending` at `document_start`; `old-reddit-active` once the root mounts.
- **Dedupe:** posts keyed by `t3_…`; later enrich passes only fill missing thumbnails. Load-more skips `t1_…` already in `#old-reddit-root`.
- **SPA:** `history.pushState` / `replaceState` wrapped; `popstate` + 1s path poll remount when the route key changes. Overlay comment links force a full load instead of SPA.
- **Unsupported `/r/…` paths** (wiki, about, search, …): early-hide and router both no-op; new Reddit shows normally.

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Shreddit markup / attrs change | Scrape helpers isolated; attrs preferred over shadow internals |
| Listing `.json` 403 | Page-context cookies; DOM + `/svc/shreddit/*` fallbacks |
| more-comments empty without cursor | Capture/POST `cursor` from `faceplate-partial` |
| SPA comment click only scrolls | Overlay capture + `location.href` / `reload` for `/comments/` links |
| Deep chain has no partial | Scrape `more-comments-link[slot=children]`; treat as permalink |
| Missing thumbs on some subs | Multi-source normalize + shreddit listing enrich + delayed DOM rescrape |
| Feed flex CSS breaking comment midcol | Listing flex rules scoped to `.thing.link`; comments keep floated midcol |
| Off-screen hide blocked hydration | Keep Shreddit in-viewport at opacity 0 |

## Non-goals (explicit)

Redirects, `old.reddit.com` fallback, login/vote/reply, sidebar parity, pixel-perfect clone of every old stylesheet, search/profiles/site home. Inventing a custom comment tree from JSON instead of Shreddit’s loaders.
