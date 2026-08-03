window.OldReddit = window.OldReddit || {};

(function (OR) {
  function textFromSlot(el, slotName) {
    const slot = el.querySelector(`[slot="${slotName}"]`);
    return slot || null;
  }

  function commentFromShredditEl(el) {
    const id = el.getAttribute("thingid") || el.getAttribute("id");
    if (!id || !id.startsWith("t1_")) return null;

    const authorAttr = el.getAttribute("author");
    const createdAttr = el.getAttribute("created");
    // Ignore placeholder custom elements with no real payload
    if (authorAttr == null && createdAttr == null) return null;

    const bodySlot = textFromSlot(el, "comment");
    let bodyHtml = "";
    let body = "";
    if (bodySlot) {
      const content =
        bodySlot.querySelector("[id$='-comment-rtjson-content'], [id$='-post-rtjson-content'], .md") ||
        bodySlot;
      bodyHtml = content.innerHTML || "";
      body = content.textContent?.trim() || "";
    }

    const depth = Number(el.getAttribute("depth") || 0);
    const scoreRaw = el.getAttribute("score");
    const score = scoreRaw == null || scoreRaw === "" ? 0 : Number(scoreRaw);
    const author = authorAttr || "[deleted]";
    const created = createdAttr || "";
    const permalink = el.getAttribute("permalink") || "";
    const parentId = el.getAttribute("parentid") || null;
    const postId = el.getAttribute("postid") || null;

    // Direct child comments in light DOM under slot=children
    const childComments = [];
    const morePartials = [];
    const childrenSlot = el.querySelector(':scope > [slot="children"]') || null;
    const searchRoot = childrenSlot || el;

    for (const child of searchRoot.querySelectorAll(":scope > shreddit-comment")) {
      const c = commentFromShredditEl(child);
      if (c) childComments.push(c);
    }
    // Also nested without being direct if structure differs
    if (!childComments.length) {
      for (const child of el.querySelectorAll("shreddit-comment")) {
        if (child === el) continue;
        if (child.parentElement?.closest("shreddit-comment") !== el) continue;
        const c = commentFromShredditEl(child);
        if (c) childComments.push(c);
      }
    }

    for (const partial of el.querySelectorAll("faceplate-partial")) {
      if (partial.closest("shreddit-comment") !== el) continue;
      const src = partial.getAttribute("src");
      if (src && src.includes("more-comments")) {
        morePartials.push({
          src: src.replace(/&amp;/g, "&"),
          method: (partial.getAttribute("method") || "post").toLowerCase(),
          count: Number(partial.querySelector("faceplate-number")?.textContent || 0) || null,
        });
      }
    }

    return {
      kind: "comment",
      id,
      commentId: id.replace(/^t1_/, ""),
      author,
      score,
      created,
      body,
      bodyHtml: bodyHtml ? `<div class="md">${bodyHtml}</div>` : "",
      permalink,
      depth,
      parentId,
      postId,
      stickied: el.hasAttribute("is-sticky") || el.getAttribute("distinguish-type") === "sticky",
      isSubmitter: el.hasAttribute("is-submitter") || el.classList.contains("submitter"),
      replies: childComments,
      _morePartials: morePartials,
    };
  }

  function scrapeOpPost() {
    const el =
      document.querySelector('shreddit-post[view-context="CommentsPage"]') ||
      document.querySelector("shreddit-post");
    return el ? OR.api.postFromShredditEl(el) : null;
  }

  function scrapeCommentForest() {
    const tree = document.querySelector("shreddit-comment-tree") || document;
    const top = [];
    const seen = new Set();

    const candidates = tree.querySelectorAll("shreddit-comment");
    for (const el of candidates) {
      const depth = Number(el.getAttribute("depth") || 0);
      if (depth !== 0) continue;
      const c = commentFromShredditEl(el);
      if (!c || seen.has(c.id)) continue;
      seen.add(c.id);
      top.push(c);
    }

    const topMore = [];
    for (const partial of document.querySelectorAll(
      "faceplate-partial.more-comments-partial, #top-level-more-comments-partial, faceplate-partial.top-level"
    )) {
      const src = partial.getAttribute("src");
      if (!src || !src.includes("more-comments")) continue;
      topMore.push({
        src: src.replace(/&amp;/g, "&"),
        method: (partial.getAttribute("method") || "post").toLowerCase(),
        count: Number(partial.querySelector("faceplate-number")?.textContent || 0) || null,
      });
    }

    return { comments: top, topMore };
  }

  async function fetchPartialHtml(src, method = "post") {
    const url = src.startsWith("http") ? src : new URL(src, location.origin).pathname + new URL(src, location.origin).search;
    const res = await fetch(url, {
      method: method.toUpperCase(),
      credentials: "include",
      headers: {
        Accept: "text/html",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: method.toLowerCase() === "post" ? "" : undefined,
    });
    if (!res.ok) throw new Error(`partial ${res.status}`);
    return res.text();
  }

  function parseCommentsFromHtml(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const out = [];
    const seen = new Set();
    for (const el of doc.querySelectorAll("shreddit-comment")) {
      // Only top-level of this fragment
      if (el.parentElement?.closest("shreddit-comment")) continue;
      // Must have real identity attrs in the markup
      if (!el.getAttribute("thingid")?.startsWith("t1_")) continue;
      if (!el.getAttribute("author") && !el.getAttribute("created")) continue;
      const c = commentFromShredditEl(el);
      if (c && !seen.has(c.id)) {
        seen.add(c.id);
        out.push(c);
      }
    }
    const mores = [];
    for (const partial of doc.querySelectorAll("faceplate-partial")) {
      const src = partial.getAttribute("src");
      if (src && src.includes("more-comments")) {
        // Prefer partials not nested under a comment we already parsed as child-owned
        mores.push({
          src: src.replace(/&amp;/g, "&"),
          method: (partial.getAttribute("method") || "post").toLowerCase(),
          count: Number(partial.querySelector("faceplate-number")?.textContent || 0) || null,
        });
      }
    }
    return { comments: out, mores };
  }

  function collectMoreJobs(nodes, jobs, depthLimit) {
    for (const node of nodes || []) {
      if (node.kind !== "comment") continue;
      if ((node.depth || 0) >= depthLimit) continue;
      for (const m of node._morePartials || []) {
        jobs.push({ partial: m, parent: node });
      }
      collectMoreJobs(node.replies, jobs, depthLimit);
    }
  }

  /**
   * Auto-expand more-comments partials until depth budget or request budget is hit.
   * Mirrors old Reddit: deep branches where Reddit provides them; stubs remain as "more".
   */
  async function deepenForest(comments, { depthLimit = 6, maxRequests = 40, topMore = [] } = {}) {
    const remainingMoreAsStubs = [];
    let requests = 0;

    // Seed queue with top-level mores and nested partials
    const queue = [];
    for (const m of topMore) queue.push({ partial: m, parent: null });
    collectMoreJobs(comments, queue, depthLimit);

    while (queue.length && requests < maxRequests) {
      const job = queue.shift();
      const startingDepth = Number(new URL(job.partial.src, location.origin).searchParams.get("startingDepth") || 0);
      if (startingDepth > depthLimit) {
        remainingMoreAsStubs.push(job);
        continue;
      }
      try {
        requests += 1;
        const html = await fetchPartialHtml(job.partial.src, job.partial.method);
        const { comments: fetched, mores } = parseCommentsFromHtml(html);
        const targetList = job.parent ? (job.parent.replies = job.parent.replies || []) : comments;
        for (const c of fetched) {
          targetList.push(c);
          collectMoreJobs([c], queue, depthLimit);
        }
        for (const m of mores) {
          queue.push({ partial: m, parent: job.parent });
        }
      } catch (err) {
        console.warn("[OldReddit] more-comments partial failed", err);
        remainingMoreAsStubs.push(job);
      }
    }

    // Convert leftover jobs into kind:more stubs on the right parent
    for (const job of [...queue, ...remainingMoreAsStubs]) {
      const stub = {
        kind: "more",
        id: `more_${Math.random().toString(36).slice(2, 8)}`,
        count: job.partial.count || 0,
        children: [],
        depth: job.parent ? (job.parent.depth || 0) + 1 : 0,
        parentId: job.parent?.id,
        _partial: job.partial,
      };
      if (job.parent) {
        job.parent.replies = job.parent.replies || [];
        job.parent.replies.push(stub);
      } else {
        comments.push(stub);
      }
    }

    // Strip scrape-only fields
    const clean = (nodes) => {
      for (const n of nodes || []) {
        if (n.kind === "comment") {
          delete n._morePartials;
          clean(n.replies);
        }
      }
    };
    clean(comments);
    return comments;
  }

  async function waitForComments({ timeoutMs = 15000 } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (document.querySelector("shreddit-comment, shreddit-comment-tree")) return true;
      await new Promise((r) => setTimeout(r, 250));
    }
    return !!document.querySelector("shreddit-comment, shreddit-comment-tree, shreddit-post");
  }

  async function loadCommentsViaDom(route) {
    await waitForComments();
    let post = scrapeOpPost();
    let { comments, topMore } = scrapeCommentForest();

    comments = await deepenForest(comments, {
      depthLimit: 6,
      maxRequests: 40,
      topMore,
    });

    // If OP missing fields, fill from route
    if (!post) {
      post = {
        id: `t3_${route.postId}`,
        postId: route.postId,
        title: document.title.replace(/\s*:\s*r\/.*$/, "") || route.postId,
        author: "[unknown]",
        score: 0,
        commentCount: comments.length,
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
      };
    }

    return { post, comments };
  }

  OR.scrapeComments = {
    commentFromShredditEl,
    scrapeOpPost,
    scrapeCommentForest,
    deepenForest,
    loadCommentsViaDom,
    fetchPartialHtml,
    parseCommentsFromHtml,
  };
})(window.OldReddit);
