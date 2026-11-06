window.OldReddit = window.OldReddit || {};

(function (OR) {
  function formatComments(n) {
    const c = Number(n) || 0;
    return c === 1 ? "1 comment" : `${c} comments`;
  }

  function thumbnailClass(post) {
    if (post.postType === "text") return "self may-blank";
    return "may-blank outbound";
  }

  function renderPostRow(post, rank) {
    const { escapeHtml, escapeAttr, canExpand, expandoClass, bindExpando } = OR.expando;
    const { relativeTime, absoluteTitle } = OR.time;

    const row = document.createElement("div");
    row.className = `thing id-${post.id} link ${post.stickied ? "stickied" : ""} ${post.postType === "text" ? "self" : ""}`;
    row.id = `thing_${post.id}`;
    row.dataset.fullname = post.id;
    row.dataset.permalink = post.permalink;

    const thumbHref = post.postType === "text" ? post.permalink : post.url || post.permalink;
    // Title goes to media/source for non-text posts; comments are via the comments link only.
    const titleHref =
      post.postType === "text"
        ? post.permalink
        : post.url || post.media?.url || post.media?.fallbackUrl || post.permalink;
    const titleExternal = post.postType !== "text" && titleHref && titleHref !== post.permalink;
    const thumbUrl =
      post.thumbnail ||
      post.media?.poster ||
      (post.media?.type === "image" ? post.media.url : null) ||
      post.media?.items?.[0]?.url ||
      null;
    const hasThumb = !!(thumbUrl && post.postType !== "text");
    const thumbInner = hasThumb
      ? `<img src="${escapeAttr(thumbUrl)}" width="54" height="54" alt="">`
      : `<div class="or-thumb-placeholder ${post.postType}"></div>`;

    const flair = post.flair
      ? `<span class="linkflairlabel" title="${escapeAttr(post.flair)}" ${
          post.flairColor ? `style="background-color:${escapeAttr(post.flairColor)};border-color:${escapeAttr(post.flairColor)}"` : ""
        }>${escapeHtml(post.flair)}</span>`
      : "";

    const showExpando = canExpand(post);
    const expandoBtn = showExpando
      ? `<div class="expando-button collapsed ${expandoClass(post)}" title="expand" role="button" tabindex="0"></div>`
      : "";

    const timeLabel = relativeTime(post.created);
    const timeTitle = absoluteTitle(post.created);

    row.innerHTML = `
      <span class="rank">${rank || ""}</span>
      <div class="midcol unvoted">
        <div class="arrow up" role="presentation"></div>
        <div class="score unvoted">${escapeHtml(String(post.score ?? "•"))}</div>
        <div class="arrow down" role="presentation"></div>
      </div>
      <a class="thumbnail ${thumbnailClass(post)}" href="${escapeAttr(thumbHref)}" ${
        post.postType !== "text" ? 'target="_blank" rel="noopener noreferrer ugc"' : ""
      }>
        ${thumbInner}
      </a>
      <div class="entry unvoted">
        <div class="top-matter">
          <p class="title">
            ${flair}
            <a class="title may-blank" href="${escapeAttr(titleHref)}" ${
              titleExternal ? 'target="_blank" rel="noopener noreferrer ugc"' : ""
            }>${escapeHtml(post.title)}</a>
          </p>
          ${expandoBtn}
          <p class="tagline">
            submitted
            <time class="live-timestamp" title="${escapeAttr(timeTitle)}">${escapeHtml(timeLabel)}</time>
            by
            <a href="/user/${escapeAttr(post.author)}/" class="author">${escapeHtml(post.author)}</a>
            ${post.stickied ? '<span class="stickied-tagline"> - stickied post</span>' : ""}
            to <a href="/r/${escapeAttr(post.subreddit)}/" class="subreddit hover">r/${escapeHtml(post.subreddit)}</a>
          </p>
          <ul class="flat-list buttons">
            <li class="first">
              <a href="${escapeAttr(post.permalink)}" class="bylink comments" rel="nofollow">${escapeHtml(formatComments(post.commentCount))}</a>
            </li>
          </ul>
        </div>
        <div class="expando" style="display:none"></div>
      </div>
      <div class="clearleft"></div>
    `;

    if (showExpando) {
      const button = row.querySelector(".expando-button");
      const expando = row.querySelector(".expando");
      bindExpando(button, expando, post);
    }

    return row;
  }

  function appendPosts(siteTable, posts, startRank) {
    const frag = document.createDocumentFragment();
    let rank = startRank;
    for (const post of posts) {
      frag.appendChild(renderPostRow(post, rank));
      rank += 1;
    }
    // Keep the sentinel / load-more footer last, if present.
    const sentinel = siteTable.querySelector("#or-feed-sentinel");
    if (sentinel) siteTable.insertBefore(frag, sentinel);
    else siteTable.appendChild(frag);
    return rank;
  }

  // Issue #4: on the hot tab, Reddit sometimes inserts exactly one old,
  // popular post (days old) among otherwise recent posts, on the first
  // load only. Drop it only when it is a clear statistical outlier in the
  // first batch: at least 48h old, at least 3x the median age, and either
  // age z >= 4 or at least 3x the second-oldest age (the second rule is
  // what catches a single 25-day post when a few moderately old posts
  // inflate the std dev enough to push z below 4). Stickied posts are
  // pinned on purpose and are never candidates. Anything else — a normal
  // spread of hot ages, two old posts, a non-hot tab — is left untouched.
  // The batch size is NOT required to be exactly 25: Reddit's JSON batch
  // shrinks below 25 when a promoted post is filtered out, and the DOM
  // fallback batch can be any size, so requiring exactly 25 silently
  // disabled the filter on live pages (the r/tennis 2026-10-30 case).
  function filterHotOutlier(posts, nowMs = Date.now()) {
    if (!Array.isArray(posts) || posts.length < 20) return { posts, dropped: null };
    const candidates = [];
    for (const p of posts) {
      if (!p || p.stickied) continue;
      const ms = OR.time.parseTimestamp(p.created);
      if (ms == null || !Number.isFinite(ms)) continue;
      const age = nowMs - ms;
      if (age < 0) continue;
      candidates.push({ post: p, age });
    }
    if (candidates.length < 15) return { posts, dropped: null };
    const ages = candidates.map((c) => c.age).sort((a, b) => a - b);
    const mean = ages.reduce((s, a) => s + a, 0) / ages.length;
    const variance = ages.reduce((s, a) => s + (a - mean) * (a - mean), 0) / ages.length;
    const std = Math.sqrt(variance);
    if (!std || !Number.isFinite(std)) return { posts, dropped: null };
    const median = ages[Math.floor(ages.length / 2)];
    const sortedDesc = [...ages].sort((a, b) => b - a);
    const secondMax = sortedDesc[1] || 0;
    const max = candidates.reduce((a, b) => (b.age > a.age ? b : a));
    const z = (max.age - mean) / std;
    const fortyEightHours = 48 * 3600 * 1000;
    if (
      max.age >= fortyEightHours &&
      max.age >= 3 * median &&
      (z >= 4 || max.age >= 3 * secondMax)
    ) {
      return { posts: posts.filter((p) => p !== max.post), dropped: max.post };
    }
    return { posts, dropped: null };
  }

  async function mountFeed(route) {
    const root = OR.shell.createRoot();
    const { siteTable, status } = OR.shell.renderShell(root, {
      subreddit: route.subreddit,
      sort: route.sort,
      t: route.t,
      mode: "feed",
    });

    OR.shell.setStatus(status, "Loading posts…");

    let nextRank = 1;
    const seen = new Set();
    // id -> created timestamp, for the hot-outlier sweep below.
    const postCreated = new Map();
    let hotSweepDone = false;
    // Backup for the pre-render filter: the first batch can arrive in
    // pieces (JSON, then DOM observer, then Shreddit enrich), so a batch
    // that was too small to judge at first render may only become a
    // full 25 once later passes land. Sweep the first 25 rendered rows
    // whenever new posts arrive, until judged at 25 rows or a drop.
    function sweepHotOutlier() {
      if (route.sort !== "hot" || hotSweepDone) return;
      const rows = [...siteTable.querySelectorAll(".thing.link")];
      if (rows.length < 20) return;
      const first = rows.slice(0, 25).map((row) => ({
        id: row.dataset.fullname,
        created: postCreated.get(row.dataset.fullname),
        stickied: row.classList.contains("stickied"),
      }));
      const { dropped } = filterHotOutlier(first);
      if (!dropped) {
        if (rows.length >= 25) hotSweepDone = true;
        return;
      }
      const row = siteTable.querySelector(`#thing_${CSS.escape(dropped.id)}`);
      if (row) row.remove();
      // Renumber so ranks stay contiguous after the removal.
      [...siteTable.querySelectorAll(".thing.link")].forEach((r, i) => {
        const rankEl = r.querySelector(".rank");
        if (rankEl) rankEl.textContent = String(i + 1);
      });
      nextRank = siteTable.querySelectorAll(".thing.link").length + 1;
      hotSweepDone = true;
      console.info("[OldReddit] hot outlier swept out", dropped.id);
    }

    const addPosts = (posts) => {
      const fresh = [];
      for (const p of posts) {
        if (!p?.id || p.promoted) continue;
        if (seen.has(p.id)) {
          // Enrich missing thumbnails on already-rendered rows
          if (p.thumbnail) {
            const row = siteTable.querySelector(`#thing_${CSS.escape(p.id)}`);
            const img = row?.querySelector("a.thumbnail img");
            const placeholder = row?.querySelector("a.thumbnail .or-thumb-placeholder");
            if (row && !img && placeholder && p.thumbnail) {
              const a = placeholder.parentElement;
              placeholder.replaceWith(
                Object.assign(document.createElement("img"), {
                  src: p.thumbnail,
                  width: 54,
                  height: 54,
                  alt: "",
                })
              );
            } else if (row && !img && !placeholder && p.thumbnail) {
              const thumb = row.querySelector("a.thumbnail");
              if (thumb && !thumb.querySelector("img")) {
                thumb.innerHTML = "";
                const image = document.createElement("img");
                image.src = p.thumbnail;
                image.width = 54;
                image.height = 54;
                image.alt = "";
                thumb.appendChild(image);
              }
            }
          }
          continue;
        }
        seen.add(p.id);
        if (p.created != null) postCreated.set(p.id, p.created);
        fresh.push(p);
      }
      if (!fresh.length) return;
      nextRank = appendPosts(siteTable, fresh, nextRank);
      OR.shell.setStatus(status, "");
      sweepHotOutlier();
    };

    // Prefer JSON listing for completeness; also observe DOM for infinite scroll extras.
    let after = null;
    try {
      const page = await OR.api.fetchListing({
        subreddit: route.subreddit,
        sort: route.sort,
        t: route.t,
        limit: 25,
      });
      let firstPosts = page.posts;
      // Issue #4, first batch only, hot tab only.
      if (route.sort === "hot") {
        const { posts: filtered, dropped } = filterHotOutlier(firstPosts);
        if (dropped) {
          // Mark it seen so the DOM observer / thumbnail enrich pass
          // cannot resurrect it from the live Shreddit feed.
          seen.add(dropped.id);
          console.info(
            "[OldReddit] hot outlier filtered out",
            dropped.id,
            dropped.title
          );
          firstPosts = filtered;
        }
      }
      addPosts(firstPosts);
      after = page.after;
    } catch (err) {
      console.warn("[OldReddit] listing JSON failed, falling back to DOM scrape", err);
      const start = Date.now();
      while (Date.now() - start < 10000 && !OR.scrapeFeed.collectFeedPosts().length) {
        await new Promise((r) => setTimeout(r, 250));
      }
      // Issue #4, DOM path too: the old code only filtered the JSON
      // batch, so a JSON failure (common logged-out) rendered the
      // outlier straight from the DOM with no filter at all.
      let domPosts = OR.scrapeFeed.collectFeedPosts();
      if (route.sort === "hot") {
        const { posts: filtered, dropped } = filterHotOutlier(domPosts);
        if (dropped) {
          seen.add(dropped.id);
          console.info("[OldReddit] hot outlier filtered out (DOM)", dropped.id);
          domPosts = filtered;
        }
      }
      addPosts(domPosts);
    }

    // Enrich missing thumbnails via shreddit HTML cards + live DOM
    const enrichThumbs = async () => {
      try {
        const page = await OR.api.fetchShredditListing({
          subreddit: route.subreddit,
          sort: route.sort,
          t: route.t,
        });
        addPosts(page.posts);
      } catch (err) {
        console.warn("[OldReddit] shreddit listing enrich failed", err);
      }
      addPosts(OR.scrapeFeed.collectFeedPosts());
    };
    enrichThumbs();
    // Second pass after media hydrates in the hidden Shreddit feed
    setTimeout(enrichThumbs, 1500);
    setTimeout(enrichThumbs, 4000);

    if (!seen.size) {
      OR.shell.setStatus(status, "Waiting for posts to load…");
    }

    const observer = OR.scrapeFeed.observeFeed((posts) => addPosts(posts));

    // Pagination, issue #1. The old code only ever paged when the initial
    // JSON call had returned an `after` cursor. If that call failed (403 /
    // challenge / rate limit — increasingly common for logged-out JSON),
    // `after` stayed null and scrolling silently did nothing, even though
    // the first 25 posts had arrived via the DOM. Now loadMore:
    //  (a) uses the JSON cursor when it exists;
    //  (b) otherwise retries JSON with the last rendered post as the cursor
    //      (Reddit accepts a t3_ fullname as `after`);
    //  (c) otherwise pages the Shreddit community-more-posts endpoint with
    //      that same last-post cursor;
    //  (d) if nothing has loaded at all yet, re-fetches the first page.
    // A sentinel at the bottom of the list plus a window scroll listener
    // (not document — window is what actually scrolls) trigger it, and a
    // visible "Load more posts" button at the foot of the feed is the manual
    // fallback if neither trigger fires. The old scroll-bridge that jerked
    // the window back up on every near-bottom scroll is gone: the hidden
    // Shreddit feed is parked at 1px, its IntersectionObserver never fires
    // there, so nudging it could never load more posts.
    let loadingMore = false;
    let paginationExhausted = false;
    const lastRenderedId = () => {
      const rows = siteTable.querySelectorAll(".thing.link");
      const last = rows[rows.length - 1];
      return last ? last.dataset.fullname : null;
    };
    const loadMore = async () => {
      if (loadingMore || paginationExhausted) return;
      loadingMore = true;
      const beforeCount = seen.size;
      try {
        if (after) {
          const page = await OR.api.fetchListing({
            subreddit: route.subreddit,
            sort: route.sort,
            t: route.t,
            after,
            limit: 25,
          });
          addPosts(page.posts);
          after = page.after;
        } else if (lastRenderedId()) {
          let gotNew = false;
          try {
            const page = await OR.api.fetchListing({
              subreddit: route.subreddit,
              sort: route.sort,
              t: route.t,
              after: lastRenderedId(),
              limit: 25,
            });
            addPosts(page.posts);
            after = page.after;
            gotNew = seen.size > beforeCount;
          } catch (err) {
            console.warn("[OldReddit] load more JSON retry failed", err);
          }
          if (!gotNew) {
            try {
              const shreddit = await OR.api.fetchShredditListing({
                subreddit: route.subreddit,
                sort: route.sort,
                t: route.t,
                after: lastRenderedId(),
              });
              addPosts(shreddit.posts);
              gotNew = seen.size > beforeCount;
            } catch (err) {
              console.warn("[OldReddit] load more shreddit failed", err);
            }
          }
          if (!gotNew) {
            // A second empty attempt means we really are at the end (or
            // both endpoints are blocked); stop hammering them on scroll.
            paginationExhausted = true;
            if (loadMoreBtn) loadMoreBtn.remove();
          }
        } else {
          // Nothing rendered yet: retry the first page.
          try {
            const page = await OR.api.fetchListing({
              subreddit: route.subreddit,
              sort: route.sort,
              t: route.t,
              limit: 25,
            });
            addPosts(page.posts);
            after = page.after;
          } catch (err) {
            console.warn("[OldReddit] load more first-page retry failed", err);
          }
        }
      } catch (err) {
        console.warn("[OldReddit] load more failed", err);
      } finally {
        loadingMore = false;
      }
    };

    const sentinel = document.createElement("div");
    sentinel.id = "or-feed-sentinel";
    siteTable.appendChild(sentinel);

    const loadMoreBtn = document.createElement("button");
    loadMoreBtn.type = "button";
    loadMoreBtn.className = "or-load-more";
    loadMoreBtn.textContent = "Load more posts";
    loadMoreBtn.addEventListener("click", loadMore);
    siteTable.appendChild(loadMoreBtn);

    const onScroll = () => {
      const nearBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 800;
      if (nearBottom) loadMore();
    };
    window.addEventListener("scroll", onScroll, { passive: true });

    const sentinelObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMore();
      },
      // Small margin: a large margin would auto-load page 2 on first paint
      // (the 25-row list is barely taller than a viewport), defeating
      // scroll pagination. The window scroll listener handles near-bottom.
      { rootMargin: "200px" }
    );
    sentinelObserver.observe(sentinel);

    return () => {
      observer.disconnect();
      sentinelObserver.disconnect();
      window.removeEventListener("scroll", onScroll);
      loadMoreBtn.remove();
      sentinel.remove();
    };
  }

  OR.renderFeed = { mountFeed, renderPostRow, appendPosts, filterHotOutlier };
})(window.OldReddit);
