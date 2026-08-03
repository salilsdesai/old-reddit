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
            <a class="title may-blank" href="${escapeAttr(post.permalink)}">${escapeHtml(post.title)}</a>
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
    siteTable.appendChild(frag);
    return rank;
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
        fresh.push(p);
      }
      if (!fresh.length) return;
      nextRank = appendPosts(siteTable, fresh, nextRank);
      OR.shell.setStatus(status, "");
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
      addPosts(page.posts);
      after = page.after;
    } catch (err) {
      console.warn("[OldReddit] listing JSON failed, falling back to DOM scrape", err);
      const start = Date.now();
      while (Date.now() - start < 10000 && !OR.scrapeFeed.collectFeedPosts().length) {
        await new Promise((r) => setTimeout(r, 250));
      }
      addPosts(OR.scrapeFeed.collectFeedPosts());
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

    // Infinite scroll: when near bottom, fetch next JSON page and nudge Shreddit.
    let loadingMore = false;
    const onScroll = async () => {
      const nearBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 800;
      if (!nearBottom || loadingMore) return;
      loadingMore = true;
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
        }
      } catch (err) {
        console.warn("[OldReddit] load more failed", err);
      } finally {
        loadingMore = false;
      }
    };
    document.addEventListener("scroll", onScroll, { passive: true });
    OR.scrapeFeed.bindInfiniteScrollBridge(
      () => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 800
    );

    return () => {
      observer.disconnect();
      document.removeEventListener("scroll", onScroll);
    };
  }

  OR.renderFeed = { mountFeed, renderPostRow, appendPosts };
})(window.OldReddit);
