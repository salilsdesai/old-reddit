window.OldReddit = window.OldReddit || {};

(function (OR) {
  function textFromSlot(el, slotName) {
    const slot = el.querySelector(`[slot="${slotName}"]`);
    return slot || null;
  }

  function partialToJob(partial) {
    const src = (partial.getAttribute("src") || "").replace(/&amp;/g, "&");
    const form = {};
    for (const input of partial.querySelectorAll("input[name]")) {
      form[input.getAttribute("name")] = input.getAttribute("value") || input.value || "";
    }
    // Also read cursor from button wrappers if present
    const cursorEl = partial.querySelector('[name="cursor"]');
    if (cursorEl && form.cursor == null) {
      form.cursor = cursorEl.getAttribute("value") || cursorEl.value || "";
    }
    return {
      src,
      method: (partial.getAttribute("method") || "post").toLowerCase(),
      count: Number(partial.querySelector("faceplate-number")?.textContent || 0) || null,
      form,
    };
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
        morePartials.push(partialToJob(partial));
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
      topMore.push(partialToJob(partial));
    }

    return { comments: top, topMore };
  }

  async function fetchPartialHtml(src, method = "post", form = null) {
    const resolved = new URL(src, location.origin);
    const url = resolved.pathname + resolved.search;
    const methodUpper = (method || "post").toUpperCase();
    const headers = {
      Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
    };
    const opts = {
      method: methodUpper,
      credentials: "include",
      headers,
    };
    if (methodUpper === "POST") {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      const params = new URLSearchParams();
      if (form && typeof form === "object") {
        for (const [k, v] of Object.entries(form)) {
          if (v != null && v !== "") params.set(k, v);
        }
      }
      opts.body = params.toString();
    }
    const res = await fetch(url, opts);
    if (!res.ok) throw new Error(`partial ${res.status}`);
    return res.text();
  }

  function materializeMorePartials(nodes) {
    for (const n of nodes || []) {
      if (n.kind !== "comment") continue;
      n.replies = Array.isArray(n.replies) ? n.replies : [];
      for (const m of n._morePartials || []) {
        n.replies.push({
          kind: "more",
          id: `more_${Math.random().toString(36).slice(2, 8)}`,
          count: m.count || 0,
          children: [],
          depth: (n.depth || 0) + 1,
          parentId: n.id,
          _partial: m,
        });
      }
      delete n._morePartials;
      materializeMorePartials(n.replies);
    }
    return nodes;
  }

  function parseCommentsFromHtml(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const out = [];
    const seen = new Set();

    // Prefer live DOM-like attribute parsing
    for (const el of doc.querySelectorAll("shreddit-comment")) {
      if (el.parentElement?.closest("shreddit-comment")) continue;
      if (!el.getAttribute("thingid")?.startsWith("t1_")) continue;
      if (!el.getAttribute("author") && !el.getAttribute("created")) continue;
      const c = commentFromShredditEl(el);
      if (c && !seen.has(c.id)) {
        seen.add(c.id);
        out.push(c);
      }
    }

    // Regex fallback if custom elements came through stripped
    if (!out.length) {
      const re =
        /<shreddit-comment\b([^>]*thingid="(t1_[^"]+)"[^>]*)>/gi;
      let m;
      while ((m = re.exec(html))) {
        const attrs = m[1];
        const id = m[2];
        if (seen.has(id)) continue;
        const get = (name) => {
          const mm = attrs.match(new RegExp(`${name}="([^"]*)"`, "i"));
          return mm ? mm[1] : null;
        };
        const author = get("author");
        const created = get("created");
        if (!author && !created) continue;
        seen.add(id);
        out.push({
          kind: "comment",
          id,
          commentId: id.replace(/^t1_/, ""),
          author: author || "[deleted]",
          score: Number(get("score") || 0),
          created: created || "",
          body: "",
          bodyHtml: "",
          permalink: get("permalink") || "",
          depth: Number(get("depth") || 0),
          parentId: get("parentid"),
          postId: get("postid"),
          stickied: false,
          isSubmitter: false,
          replies: [],
          _morePartials: [],
        });
      }
      // Try to attach bodies from rtjson blocks
      for (const c of out) {
        const bodyRe = new RegExp(
          `id="${c.id}-(?:comment|post)-rtjson-content"[^>]*>([\\s\\S]*?)</div>`,
          "i"
        );
        const bm = html.match(bodyRe);
        if (bm) {
          c.bodyHtml = `<div class="md">${bm[1]}</div>`;
          const tmp = document.createElement("div");
          tmp.innerHTML = bm[1];
          c.body = tmp.textContent?.trim() || "";
        }
      }
    }

    // Nested more-comments live on each comment as _morePartials; only keep
    // partials that aren't nested under a shreddit-comment as top-level mores.
    const mores = [];
    for (const partial of doc.querySelectorAll("faceplate-partial")) {
      const src = partial.getAttribute("src");
      if (!src || !src.includes("more-comments")) continue;
      if (partial.closest("shreddit-comment")) continue;
      mores.push(partialToJob(partial));
    }
    // Regex fallback for cursor-bearing partials (treat as top-level)
    if (!mores.length && !out.some((c) => (c._morePartials || []).length)) {
      const pre =
        /<faceplate-partial([^>]*more-comments[^>]*)>([\s\S]*?)<\/faceplate-partial>/gi;
      let pm;
      while ((pm = pre.exec(html))) {
        const attrs = pm[1];
        const body = pm[2];
        const srcM = attrs.match(/src="([^"]+)"/i);
        if (!srcM) continue;
        const cursorM =
          body.match(/name="cursor"[^>]*value="([^"]*)"/i) ||
          body.match(/value="([^"]*)"[^>]*name="cursor"/i);
        mores.push({
          src: srcM[1].replace(/&amp;/g, "&"),
          method: "post",
          count: null,
          form: cursorM ? { cursor: cursorM[1] } : {},
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
        const html = await fetchPartialHtml(job.partial.src, job.partial.method, job.partial.form);
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

    // Any _morePartials not queued (e.g. past depthLimit) become clickable stubs
    materializeMorePartials(comments);
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

  function attachDomPartialsToMores(comments) {
    try {
      // Only attach to more stubs that have no children IDs (JSON morechildren won't help)
      const unused = [];
      for (const partial of document.querySelectorAll("faceplate-partial")) {
        const src = partial.getAttribute("src");
        if (!src || !src.includes("more-comments")) continue;
        unused.push(partialToJob(partial));
      }

      const walk = (nodes) => {
        for (const n of nodes || []) {
          if (
            n.kind === "more" &&
            !n._partial &&
            !(n.children && n.children.length) &&
            unused.length
          ) {
            const idx = unused.findIndex((p) => p.form && p.form.cursor);
            const job = unused.splice(idx >= 0 ? idx : 0, 1)[0];
            if (job) {
              n._partial = job;
              if (!n.count && job.count) n.count = job.count;
            }
          } else if (n.kind === "comment") {
            walk(n.replies);
          }
        }
      };
      walk(comments);
    } catch (err) {
      console.warn("[OldReddit] attachDomPartialsToMores failed", err);
    }
    return comments;
  }

  OR.scrapeComments = {
    commentFromShredditEl,
    scrapeOpPost,
    scrapeCommentForest,
    deepenForest,
    loadCommentsViaDom,
    fetchPartialHtml,
    parseCommentsFromHtml,
    materializeMorePartials,
    attachDomPartialsToMores,
    waitForComments,
    partialToJob,
  };
})(window.OldReddit);
