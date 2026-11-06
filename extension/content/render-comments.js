window.OldReddit = window.OldReddit || {};

(function (OR) {
  function localPath(href) {
    if (!href || href === "#") return "#";
    try {
      const u = new URL(href.replace(/&amp;/g, "&"), location.origin);
      if (u.origin === location.origin || /reddit\.com$/i.test(u.hostname)) {
        return u.pathname + u.search;
      }
      return href;
    } catch (_) {
      return href;
    }
  }

  function countChildren(nodes) {
    let n = 0;
    for (const node of nodes || []) {
      if (node.kind === "comment") {
        n += 1 + countChildren(node.replies);
      } else if (node.kind === "more") {
        n += node.count || 0;
      }
    }
    return n;
  }

  function isValidComment(node) {
    if (!node || node.kind !== "comment") return false;
    if (!node.id || !String(node.id).startsWith("t1_")) return false;
    const hasBody = !!(node.body || node.bodyHtml);
    const hasAuthor = !!(node.author && node.author !== "[deleted]");
    const hasTime = node.created != null && Number.isFinite(OR.time.parseTimestamp(node.created));
    if (!hasBody && !hasAuthor && !hasTime) return false;
    return true;
  }

  function renderComment(node, opts) {
    const { linkId, sort, subreddit } = opts || {};
    const { escapeHtml, escapeAttr, decodeHtml } = OR.expando;
    const { relativeTime, absoluteTitle } = OR.time;

    if (node.kind === "more") {
      return renderMore(node, opts);
    }
    if (!isValidComment(node)) return document.createDocumentFragment();

    const el = document.createElement("div");
    el.className = `thing id-${node.id} comment noncollapsed`;
    el.id = `thing_${node.id}`;
    el.dataset.fullname = node.id;
    el.dataset.type = "comment";

    const childCount = countChildren(node.replies);
    const timeLabel = relativeTime(node.created) || "";
    const timeTitle = absoluteTitle(node.created);
    const body = node.bodyHtml
      ? decodeHtml(node.bodyHtml)
      : `<div class="md"><p>${escapeHtml(node.body || "")}</p></div>`;

    el.innerHTML = `
      <div class="midcol unvoted">
        <div class="arrow up" role="presentation"></div>
        <div class="arrow down" role="presentation"></div>
      </div>
      <div class="entry unvoted">
        <p class="tagline">
          <a href="javascript:void(0)" class="expand" role="button">[–]</a>
          <a href="/user/${escapeAttr(node.author)}/" class="author ${node.isSubmitter ? "submitter" : ""}">${escapeHtml(node.author || "[deleted]")}</a>
          <span class="score unvoted">${escapeHtml(String(node.score ?? 0))} points</span>
          ${timeLabel ? `<time class="live-timestamp" title="${escapeAttr(timeTitle)}">${escapeHtml(timeLabel)}</time>` : ""}
          <a href="${escapeAttr(localPath(node.permalink || "#"))}" class="numchildren">(${childCount} ${childCount === 1 ? "child" : "children"})</a>
        </p>
        <form class="usertext">
          <div class="usertext-body may-blank-within md-container">${body}</div>
        </form>
        <ul class="flat-list buttons">
          <li class="first"><a href="${escapeAttr(localPath(node.permalink || "#"))}" class="bylink" rel="nofollow">permalink</a></li>
        </ul>
      </div>
      <div class="child"><div class="sitetable listing"></div></div>
    `;

    const childListing = el.querySelector(".child > .sitetable");
    for (const reply of node.replies || []) {
      const child = renderComment(reply, opts);
      if (child.childNodes?.length || child.nodeType === 1) childListing.appendChild(child);
    }

    const expandBtn = el.querySelector("a.expand");
    expandBtn.addEventListener("click", (e) => {
      e.preventDefault();
      const collapsed = el.classList.contains("collapsed");
      if (collapsed) {
        el.classList.remove("collapsed");
        el.classList.add("noncollapsed");
        expandBtn.textContent = "[–]";
      } else {
        el.classList.add("collapsed");
        el.classList.remove("noncollapsed");
        expandBtn.textContent = "[+]";
      }
    });

    return el;
  }

  function renderMore(node, opts) {
    const el = document.createElement("div");
    el.className = "thing morechildren";
    el.dataset.type = "morechildren";
    if (node._partial?.topLevel) el.dataset.topLevel = "1";
    const count = node.count || 0;
    const label =
      count > 0
        ? `load more comments <span class="gray">(${count} replies)</span>`
        : `load more comments`;

    const href = node.continueHref ? localPath(node.continueHref) : "javascript:void(0)";
    el.innerHTML = `
      <span class="morecomments">
        <a href="${OR.expando.escapeAttr(href)}" class="or-more-btn">${label}</a>
      </span>
    `;

    const btn = el.querySelector(".or-more-btn");
    btn.addEventListener("click", (e) => {
      if (node.continueHref) return;
      e.preventDefault();
      loadMoreStub(el, node, opts);
    });

    return el;
  }

  async function loadMoreStub(el, node, opts) {
    const btn = el.querySelector(".or-more-btn");
    if (!btn || btn.dataset.loading === "1") return;
    btn.dataset.loading = "1";
    const prev = btn.innerHTML;
    btn.textContent = "loading...";
    try {
      const job = node._partial;
      if (!job?.src) throw new Error("no more-comments endpoint");
      const html = await OR.scrapeComments.fetchPartialHtml(job.src, job.method, job.form);
      const { comments, mores } = OR.scrapeComments.parseCommentsFromHtml(html);
      const listing = el.parentElement;
      const seen = new Set(
        [...document.querySelectorAll("#old-reddit-root .thing.comment")].map((n) => n.dataset.fullname)
      );
      let inserted = 0;
      const append = (nodes) => {
        for (const t of nodes || []) {
          if (t.kind === "comment" && seen.has(t.id)) continue;
          if (t.kind === "comment") seen.add(t.id);
          const nodeEl = renderComment(t, opts);
          if (!nodeEl || (nodeEl.nodeType !== 1 && !nodeEl.childNodes?.length)) continue;
          listing.insertBefore(nodeEl, el);
          inserted += 1;
        }
      };
      append(comments);
      append(
        (mores || []).map((m) =>
          OR.scrapeComments.moreStub(m, node.parentId || null, node.depth || 0)
        )
      );
      if (inserted) el.remove();
      else {
        btn.innerHTML = prev;
        btn.dataset.loading = "0";
        btn.title = "Reddit returned no comments for this stub";
      }
    } catch (err) {
      console.warn("[OldReddit] more-comments failed", err);
      btn.textContent = "loading failed — click to retry";
      btn.dataset.loading = "0";
    }
  }

  function renderOp(post) {
    const { escapeHtml, escapeAttr, canExpand, expandoClass, bindExpando, decodeHtml } = OR.expando;
    const { relativeTime, absoluteTitle } = OR.time;

    const el = document.createElement("div");
    el.className = `thing id-${post.id} link ${post.postType === "text" ? "self" : ""}`;
    el.dataset.fullname = post.id;

    const timeLabel = relativeTime(post.created);
    const timeTitle = absoluteTitle(post.created);
    const flair = post.flair
      ? `<span class="linkflairlabel">${escapeHtml(post.flair)}</span>`
      : "";

    const showExpando = canExpand(post) && post.postType !== "text";
    let bodyBlock = "";
    if (post.postType === "text" || post.selftext || post.selftextHtml) {
      const html = post.selftextHtml
        ? decodeHtml(post.selftextHtml)
        : `<div class="md"><p>${escapeHtml(post.selftext || "")}</p></div>`;
      bodyBlock = `<div class="expando" style="display:block"><div class="usertext-body may-blank-within md-container border">${html}</div></div>`;
    } else if (showExpando) {
      bodyBlock = `<div class="expando-button collapsed ${expandoClass(post)}" role="button" tabindex="0"></div><div class="expando" style="display:none"></div>`;
    }

    if (post.media && post.postType !== "text") {
      bodyBlock = `<div class="expando" style="display:block" data-ready="1"></div>`;
    }

    el.innerHTML = `
      <p class="parent"></p>
      <div class="midcol unvoted">
        <div class="arrow up" role="presentation"></div>
        <div class="score unvoted">${escapeHtml(String(post.score ?? 0))}</div>
        <div class="arrow down" role="presentation"></div>
      </div>
      <div class="entry unvoted">
        <div class="top-matter">
          <p class="title">
            ${flair}
            <a class="title" href="${escapeAttr(post.url || post.permalink)}">${escapeHtml(post.title)}</a>
            <span class="domain">(<span>${escapeHtml(post.domain || "reddit.com")}</span>)</span>
          </p>
          <p class="tagline">
            submitted
            <time title="${escapeAttr(timeTitle)}">${escapeHtml(timeLabel)}</time>
            by <a class="author" href="/user/${escapeAttr(post.author)}/">${escapeHtml(post.author)}</a>
          </p>
          <ul class="flat-list buttons">
            <li class="first"><a href="${escapeAttr(post.permalink)}" class="bylink comments">${post.commentCount} comments</a></li>
          </ul>
        </div>
        ${bodyBlock}
      </div>
      <div class="clearleft"></div>
    `;

    const expando = el.querySelector(".expando");
    if (expando && post.media && post.postType !== "text") {
      OR.expando.setExpandoContent(expando, post);
    } else if (showExpando) {
      const button = el.querySelector(".expando-button");
      if (button && expando) bindExpando(button, expando, post);
    }

    return el;
  }

  function fallbackPost(route) {
    return (
      OR.scrapeComments.scrapeOpPost() || {
        id: `t3_${route.postId}`,
        postId: route.postId,
        title: document.title.replace(/\s*:\s*r\/.*$/, "") || route.postId,
        author: "[unknown]",
        score: 0,
        commentCount: "",
        created: Date.now(),
        permalink: location.pathname,
        url: location.href,
        domain: "reddit.com",
        subreddit: route.subreddit,
        postType: "text",
        thumbnail: null,
        selftext: "",
        selftextHtml: null,
        media: null,
      }
    );
  }

  let mountGeneration = 0;

  async function mountComments(route) {
    const generation = ++mountGeneration;
    const commentSort = route.commentSort || "confidence";
    const root = OR.shell.createRoot();
    const shell = OR.shell.renderShell(root, {
      subreddit: route.subreddit,
      sort: "hot",
      mode: "comments",
      commentSort,
    });
    const { siteTable, status } = shell;
    const opts = { linkId: `t3_${route.postId}`, sort: commentSort, subreddit: route.subreddit };

    let scrollBound = null;

    const cleanup = () => {
      if (scrollBound) window.removeEventListener("scroll", scrollBound);
    };

    try {
      let post = fallbackPost(route);
      opts.linkId = post.id || opts.linkId;
      siteTable.className = "sitetable linklisting";
      const opWrap = document.createElement("div");
      opWrap.className = "or-op";
      opWrap.appendChild(renderOp(post));
      siteTable.appendChild(opWrap);

      const commentArea = document.createElement("div");
      commentArea.className = "commentarea";
      commentArea.innerHTML = `
        <div class="panestack-title"><span class="title">all ${post.commentCount ?? ""} comments</span></div>
        ${shell.commentSortMenuHtml()}
      `;
      const nested = document.createElement("div");
      nested.className = "sitetable nestedlisting";
      commentArea.appendChild(nested);
      siteTable.appendChild(commentArea);
      shell.bindCommentSortSelect();
      OR.shell.setStatus(status, "Loading comments…");

      await OR.scrapeComments.waitForComments({ timeoutMs: 8000 });
      const waitMores = Date.now();
      while (
        Date.now() - waitMores < 1500 &&
        !document.querySelector(
          "#top-level-more-comments-partial, faceplate-partial.more-comments-partial"
        )
      ) {
        await new Promise((r) => setTimeout(r, 100));
      }
      if (generation !== mountGeneration) return cleanup;

      const scraped = OR.scrapeComments.scrapeOpPost();
      if (scraped) {
        post = scraped;
        opts.linkId = post.id;
        opWrap.innerHTML = "";
        opWrap.appendChild(renderOp(post));
        const title = commentArea.querySelector(".panestack-title .title");
        if (title) title.textContent = `all ${post.commentCount ?? ""} comments`;
      }

      const forest = OR.scrapeComments.forestFromNative();
      nested.innerHTML = "";
      for (const c of forest) {
        const nodeEl = renderComment(c, opts);
        if (nodeEl.nodeType === 1) nested.appendChild(nodeEl);
      }
      OR.shell.setStatus(status, forest.length ? "" : "Loading comments…");

      const maybeAutoloadTop = () => {
        if (generation !== mountGeneration) return;
        const stub = nested.querySelector(":scope > .thing.morechildren[data-top-level='1']");
        if (!stub) return;
        const rect = stub.getBoundingClientRect();
        if (rect.top < window.innerHeight + 400) {
          const btn = stub.querySelector(".or-more-btn");
          if (btn && btn.dataset.loading !== "1") btn.click();
        }
      };
      scrollBound = () => maybeAutoloadTop();
      window.addEventListener("scroll", scrollBound, { passive: true });
      maybeAutoloadTop();

      OR.api
        .fetchComments({
          subreddit: route.subreddit,
          postId: route.postId,
          limit: 1,
          depth: 0,
          sort: commentSort,
        })
        .then((data) => {
          if (generation !== mountGeneration || !data.post) return;
          post = { ...post, ...data.post };
          opts.linkId = post.id;
          opWrap.innerHTML = "";
          opWrap.appendChild(renderOp(post));
          const title = commentArea.querySelector(".panestack-title .title");
          if (title) title.textContent = `all ${post.commentCount ?? ""} comments`;
        })
        .catch((err) => console.warn("[OldReddit] post JSON failed", err));
    } catch (err) {
      if (generation !== mountGeneration) return cleanup;
      console.error("[OldReddit] comments failed", err);
      OR.shell.setStatus(
        status,
        `Failed to load comments (${err.message}).`,
        { error: true, onRetry: () => mountComments(route) }
      );
    }

    return cleanup;
  }

  OR.renderComments = { mountComments, renderComment, renderOp };
})(window.OldReddit);
