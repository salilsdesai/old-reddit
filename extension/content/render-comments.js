window.OldReddit = window.OldReddit || {};

(function (OR) {
  function countChildren(nodes) {
    let n = 0;
    for (const node of nodes || []) {
      if (node.kind === "comment") {
        n += 1 + countChildren(node.replies);
      } else if (node.kind === "more") {
        n += node.count || node.children?.length || 0;
      }
    }
    return n;
  }

  function isValidComment(node) {
    if (!node || node.kind !== "comment") return false;
    if (!node.id || !String(node.id).startsWith("t1_")) return false;
    // Reject empty shells from bad partial parses
    const hasBody = !!(node.body || node.bodyHtml);
    const hasAuthor = !!(node.author && node.author !== "[deleted]");
    const hasTime = node.created != null && Number.isFinite(OR.time.parseTimestamp(node.created));
    if (!hasBody && !hasAuthor && !hasTime) return false;
    return true;
  }

  function renderComment(node, { linkId, sort, subreddit }) {
    const { escapeHtml, escapeAttr, decodeHtml } = OR.expando;
    const { relativeTime, absoluteTitle } = OR.time;

    if (node.kind === "more") {
      return renderMore(node, { linkId, sort, subreddit });
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
          <a href="${escapeAttr(node.permalink || "#")}" class="numchildren">(${childCount} ${childCount === 1 ? "child" : "children"})</a>
        </p>
        <form class="usertext">
          <div class="usertext-body may-blank-within md-container">${body}</div>
        </form>
        <ul class="flat-list buttons">
          <li class="first"><a href="${escapeAttr(node.permalink || "#")}" class="bylink" rel="nofollow">permalink</a></li>
        </ul>
      </div>
      <div class="child"><div class="sitetable listing"></div></div>
    `;

    const childListing = el.querySelector(".child > .sitetable");
    for (const reply of node.replies || []) {
      const child = renderComment(reply, { linkId, sort, subreddit });
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

  function collectLoadedIds(nodes, into = new Set()) {
    for (const n of nodes || []) {
      if (n.kind === "comment") {
        into.add(n.id);
        into.add(n.commentId);
        into.add(String(n.id || "").replace(/^t1_/, ""));
        collectLoadedIds(n.replies, into);
      }
      // Nested "more" stubs are still pending — don't treat their children as loaded
    }
    return into;
  }

  function buildForestFromThings(things, { requestedIds = [], parentIdHint = null } = {}) {
    const byId = new Map();
    const comments = [];
    const mores = [];
    for (const t of things || []) {
      if (t.kind === "more") {
        mores.push(t);
        continue;
      }
      if (t.kind !== "comment") continue;
      t.replies = Array.isArray(t.replies) ? t.replies : [];
      byId.set(t.id, t);
      comments.push(t);
    }

    const roots = [];
    for (const t of comments) {
      const parent = byId.get(t.parentId);
      if (parent && parent.id !== t.id) parent.replies.push(t);
      else roots.push(t);
    }
    for (const m of mores) {
      const parent = byId.get(m.parentId);
      if (parent) parent.replies.push(m);
      else roots.push(m);
    }

    // Keep a stub for child IDs the API didn't return (classic morechildren behavior)
    const loaded = collectLoadedIds(roots);
    const remaining = (requestedIds || []).filter((id) => {
      const bare = String(id).replace(/^t1_/, "");
      return !loaded.has(id) && !loaded.has(bare) && !loaded.has(`t1_${bare}`);
    });
    if (remaining.length) {
      roots.push({
        kind: "more",
        id: `more_${Math.random().toString(36).slice(2, 8)}`,
        count: remaining.length,
        children: remaining,
        parentId: parentIdHint || null,
      });
    }
    return roots;
  }

  function renderMore(node, { linkId, sort, subreddit }) {
    const el = document.createElement("div");
    el.className = "thing morechildren";
    el.dataset.type = "morechildren";
    const count = node.count || node.children?.length || 0;
    const label =
      count > 0
        ? `load more comments <span class="gray">(${count} replies)</span>`
        : `load more comments`;

    el.innerHTML = `
      <span class="morecomments">
        <a href="javascript:void(0)" class="or-more-btn">${label}</a>
      </span>
    `;

    const btn = el.querySelector(".or-more-btn");
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      if (btn.dataset.loading === "1") return;
      btn.dataset.loading = "1";
      const prev = btn.innerHTML;
      btn.textContent = "loading...";
      try {
        const parentListing = el.parentElement;
        const frag = document.createDocumentFragment();
        let inserted = 0;

        const appendNodes = (nodes) => {
          for (const t of nodes || []) {
            const nodeEl = renderComment(t, { linkId, sort, subreddit });
            if (nodeEl && nodeEl.nodeType === 1) {
              frag.appendChild(nodeEl);
              inserted += 1;
            } else if (nodeEl?.childNodes?.length) {
              // DocumentFragment with children (shouldn't happen for valid nodes)
              frag.appendChild(nodeEl);
              inserted += 1;
            }
          }
        };

        let usedPartial = false;
        if (node._partial?.src) {
          try {
            const html = await OR.scrapeComments.fetchPartialHtml(
              node._partial.src,
              node._partial.method || "post",
              node._partial.form || null
            );
            const { comments: fetched, mores } = OR.scrapeComments.parseCommentsFromHtml(html);
            // Nested faceplate-partials must become load-more stubs under their parents
            OR.scrapeComments.materializeMorePartials(fetched);
            if (fetched.length || (mores && mores.length)) {
              usedPartial = true;
              appendNodes(fetched);
              for (const m of mores || []) {
                appendNodes([
                  {
                    kind: "more",
                    id: `more_${Math.random().toString(36).slice(2, 8)}`,
                    count: m.count || 0,
                    children: [],
                    _partial: m,
                  },
                ]);
              }
            }
          } catch (err) {
            console.warn("[OldReddit] more-comments partial failed, trying API", err);
          }
        }

        if (!usedPartial) {
          const ids = (node.children || []).slice(0, 100);
          let things = [];
          if (ids.length) {
            try {
              things = await OR.api.fetchMoreChildren({
                linkId,
                children: ids,
                sort,
                depth: 8,
                moreId: node.id,
              });
            } catch (err) {
              console.warn("[OldReddit] morechildren API failed", err);
            }
          }

          // Fallback: fetch a branch starting at the first missing child
          if (!things.length && ids.length && subreddit) {
            const postId = String(linkId).replace(/^t3_/, "");
            try {
              things = await OR.api.fetchCommentBranch({
                subreddit,
                postId,
                commentId: ids[0],
                sort,
                depth: 8,
              });
            } catch (err) {
              console.warn("[OldReddit] comment branch fallback failed", err);
            }
          }

          // Fallback: shreddit single-comment HTML
          if (!things.length && ids.length && subreddit) {
            const cid = String(ids[0]).replace(/^t1_/, "");
            try {
              const html = await OR.scrapeComments.fetchPartialHtml(
                `/svc/shreddit/comment/t1_${cid}?depth=5&subredditName=${encodeURIComponent(subreddit)}`,
                "get",
                null
              );
              const parsed = OR.scrapeComments.parseCommentsFromHtml(html);
              OR.scrapeComments.materializeMorePartials(parsed.comments || []);
              things = parsed.comments || [];
            } catch (err) {
              console.warn("[OldReddit] shreddit comment fallback failed", err);
            }
          }

          const roots = buildForestFromThings(things, {
            requestedIds: ids,
            parentIdHint: node.parentId || null,
          });
          appendNodes(roots);
        }

        if (inserted) {
          parentListing.insertBefore(frag, el);
          el.remove();
        } else {
          btn.innerHTML = prev;
          btn.dataset.loading = "0";
          btn.title = "Reddit returned no comments for this stub";
          // leave clickable for retry
        }
      } catch (err) {
        console.warn("[OldReddit] morechildren failed", err);
        btn.textContent = "loading failed — click to retry";
        btn.dataset.loading = "0";
      }
    });

    return el;
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

  async function mountComments(route) {
    const commentSort = route.commentSort || "confidence";
    const root = OR.shell.createRoot();
    const shell = OR.shell.renderShell(root, {
      subreddit: route.subreddit,
      sort: "hot",
      mode: "comments",
      commentSort,
    });
    const { siteTable, status } = shell;

    OR.shell.setStatus(status, "Loading comments…");

    try {
      let post = null;
      let comments = null;

      try {
        const data = await OR.api.fetchComments({
          subreddit: route.subreddit,
          postId: route.postId,
          limit: 200,
          depth: 6,
          sort: commentSort,
        });
        post = data.post;
        comments = data.comments;
        // Attach live shreddit "more" cursors so load-more works when morechildren is empty
        const start = Date.now();
        while (
          Date.now() - start < 2500 &&
          !document.querySelector("faceplate-partial[src*='more-comments']")
        ) {
          await new Promise((r) => setTimeout(r, 200));
        }
        comments = OR.scrapeComments.attachDomPartialsToMores(comments);
      } catch (err) {
        console.warn("[OldReddit] comments JSON failed, using DOM scrape", err);
        OR.shell.setStatus(status, "Loading comments from page…");
        const data = await OR.scrapeComments.loadCommentsViaDom(route);
        post = data.post;
        comments = data.comments;
      }

      if (!post) throw new Error("Post not found");

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
      const linkId = post.id;
      for (const c of comments || []) {
        const nodeEl = renderComment(c, {
          linkId,
          sort: commentSort,
          subreddit: route.subreddit,
        });
        if (nodeEl.nodeType === 1) nested.appendChild(nodeEl);
      }
      commentArea.appendChild(nested);
      siteTable.appendChild(commentArea);
      shell.bindCommentSortSelect();

      OR.shell.setStatus(status, "");
    } catch (err) {
      console.error("[OldReddit] comments failed", err);
      OR.shell.setStatus(
        status,
        `Failed to load comments (${err.message}). Try refreshing.`,
        { error: true }
      );
    }
  }

  OR.renderComments = { mountComments, renderComment, renderOp };
})(window.OldReddit);
