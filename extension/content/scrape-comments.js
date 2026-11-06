window.OldReddit = window.OldReddit || {};

(function (OR) {
  function textFromSlot(el, slotName) {
    const slot = el.querySelector(`[slot="${slotName}"]`);
    return slot || null;
  }

  function partialToJob(partial) {
    if (!partial) return null;
    const src = (partial.getAttribute("src") || "").replace(/&amp;/g, "&");
    if (!src || !/more-comments/i.test(src)) return null;
    const form = {};
    for (const input of partial.querySelectorAll("input[name]")) {
      form[input.getAttribute("name")] = input.getAttribute("value") || input.value || "";
    }
    const numEl = partial.querySelector("faceplate-number");
    let count =
      Number(numEl?.getAttribute("number") || numEl?.textContent || 0) || 0;
    if (!count) {
      const rem = src.match(/comments-remaining=(\d+)/i);
      if (rem) count = Number(rem[1]);
    }
    return {
      src,
      method: (partial.getAttribute("method") || "post").toLowerCase(),
      count: count || 0,
      form,
      topLevel:
        partial.id === "top-level-more-comments-partial" ||
        partial.classList.contains("top-level") ||
        /top-level=1/i.test(src),
    };
  }

  function moreStub(job, parentId, depth) {
    return {
      kind: "more",
      id: `more_${Math.random().toString(36).slice(2, 10)}`,
      count: job.count || 0,
      children: [],
      depth: depth || 0,
      parentId: parentId || null,
      _partial: job,
    };
  }

  function localPath(href) {
    if (!href) return "";
    try {
      const u = new URL(href.replace(/&amp;/g, "&"), location.origin);
      return u.pathname + u.search;
    } catch (_) {
      return href;
    }
  }

  function collectMorePartials(host) {
    const jobs = [];
    const seen = new Set();
    for (const partial of host.querySelectorAll("faceplate-partial")) {
      if (partial.closest("shreddit-comment") !== host) continue;
      const job = partialToJob(partial);
      if (!job || seen.has(job.src + (job.form.cursor || ""))) continue;
      seen.add(job.src + (job.form.cursor || ""));
      jobs.push(job);
    }
    return jobs;
  }

  /** Deep chains: Reddit stops expanding and links to the comment permalink instead. */
  function collectContinueLinks(host) {
    const jobs = [];
    const seen = new Set();
    for (const a of host.querySelectorAll("a.more-comments-link")) {
      if (a.closest("shreddit-comment") !== host) continue;
      if (a.closest("faceplate-partial")) continue;
      if (a.closest(".fold-more")) continue;
      if (a.getAttribute("slot") !== "children") continue;
      const href = localPath(a.getAttribute("href") || "");
      if (!href || !/\/comments\/[^/]+\/comment\//i.test(href)) continue;
      if (seen.has(href)) continue;
      seen.add(href);
      const numEl = a.querySelector("faceplate-number");
      const count = Number(numEl?.getAttribute("number") || numEl?.textContent || 0) || 0;
      jobs.push({ continueHref: href, count, form: {} });
    }
    return jobs;
  }

  function commentFromShredditEl(el) {
    const id = el.getAttribute("thingid") || el.getAttribute("id");
    if (!id || !id.startsWith("t1_")) return null;

    const authorAttr = el.getAttribute("author");
    const createdAttr = el.getAttribute("created");
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

    const childComments = [];
    const childrenSlot = el.querySelector(':scope > [slot="children"]') || null;
    const searchRoot = childrenSlot || el;

    for (const child of searchRoot.querySelectorAll(":scope > shreddit-comment")) {
      const c = commentFromShredditEl(child);
      if (c) childComments.push(c);
    }
    if (!childComments.length) {
      for (const child of el.querySelectorAll("shreddit-comment")) {
        if (child === el) continue;
        if (child.parentElement?.closest("shreddit-comment") !== el) continue;
        const c = commentFromShredditEl(child);
        if (c) childComments.push(c);
      }
    }

    return {
      kind: "comment",
      id,
      commentId: id.replace(/^t1_/, ""),
      author: authorAttr || "[deleted]",
      score: Number(el.getAttribute("score") || 0),
      created: createdAttr || "",
      body,
      bodyHtml: bodyHtml ? `<div class="md">${bodyHtml}</div>` : "",
      permalink: el.getAttribute("permalink") || "",
      depth: Number(el.getAttribute("depth") || 0),
      parentId: el.getAttribute("parentid") || null,
      postId: el.getAttribute("postid") || null,
      stickied: el.hasAttribute("is-sticky") || el.getAttribute("distinguish-type") === "sticky",
      isSubmitter: el.hasAttribute("is-submitter") || el.classList.contains("submitter") || el.hasAttribute("is-op"),
      replies: childComments,
      _morePartials: collectMorePartials(el),
      _continues: collectContinueLinks(el),
    };
  }

  function scrapeOpPost() {
    const el =
      document.querySelector('shreddit-post[view-context="CommentsPage"]') ||
      document.querySelector("shreddit-post");
    return el ? OR.api.postFromShredditEl(el) : null;
  }

  function collectTopMore() {
    const jobs = [];
    const seen = new Set();
    const nodes = document.querySelectorAll(
      "#top-level-more-comments-partial, faceplate-partial.top-level, shreddit-comment-tree > faceplate-partial, shreddit-comment-tree faceplate-partial.top-level"
    );
    for (const partial of nodes) {
      if (partial.closest("shreddit-comment")) continue;
      const job = partialToJob(partial);
      if (!job) continue;
      const key = job.src + "|" + (job.form.cursor || "");
      if (seen.has(key)) continue;
      seen.add(key);
      jobs.push(job);
    }
    return jobs;
  }

  function materializeMorePartials(nodes) {
    for (const n of nodes || []) {
      if (n.kind !== "comment") continue;
      n.replies = Array.isArray(n.replies) ? n.replies : [];
      for (const m of n._morePartials || []) {
        n.replies.push(moreStub(m, n.id, (n.depth || 0) + 1));
      }
      for (const c of n._continues || []) {
        n.replies.push({
          kind: "more",
          id: `more_${Math.random().toString(36).slice(2, 10)}`,
          count: c.count || 0,
          children: [],
          depth: (n.depth || 0) + 1,
          parentId: n.id,
          continueHref: c.continueHref,
        });
      }
      delete n._morePartials;
      delete n._continues;
      materializeMorePartials(n.replies);
    }
    return nodes;
  }

  function forestFromNative() {
    const tree = document.querySelector("shreddit-comment-tree") || document;
    const top = [];
    const seen = new Set();
    for (const el of tree.querySelectorAll("shreddit-comment")) {
      if (el.parentElement?.closest("shreddit-comment")) continue;
      const c = commentFromShredditEl(el);
      if (!c || seen.has(c.id)) continue;
      seen.add(c.id);
      top.push(c);
    }
    materializeMorePartials(top);
    for (const job of collectTopMore()) {
      top.push(moreStub(job, null, 0));
    }
    return top;
  }

  async function fetchPartialHtml(src, method = "post", form = null) {
    const resolved = new URL(src, location.origin);
    const url = resolved.pathname + resolved.search;
    const methodUpper = (method || "post").toUpperCase();
    const headers = {
      Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
    };
    const opts = { method: methodUpper, credentials: "include", headers };
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
    const res = await OR.api.fetchWithTimeout(url, opts, 20000);
    if (!res.ok) throw new Error(`more-comments HTTP ${res.status}`);
    return res.text();
  }

  function parseCommentsFromHtml(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const out = [];
    const seen = new Set();
    for (const el of doc.querySelectorAll("shreddit-comment")) {
      if (el.parentElement?.closest("shreddit-comment")) continue;
      const c = commentFromShredditEl(el);
      if (!c || seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c);
    }
    materializeMorePartials(out);

    const mores = [];
    const moreKeys = new Set();
    for (const partial of doc.querySelectorAll("faceplate-partial")) {
      if (partial.closest("shreddit-comment")) continue;
      const job = partialToJob(partial);
      if (!job) continue;
      const key = job.src + "|" + (job.form.cursor || "");
      if (moreKeys.has(key)) continue;
      moreKeys.add(key);
      mores.push(job);
    }
    return { comments: out, mores };
  }

  async function waitForComments({ timeoutMs = 15000 } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (document.querySelector("shreddit-comment, shreddit-comment-tree")) return true;
      await new Promise((r) => setTimeout(r, 250));
    }
    return !!document.querySelector("shreddit-comment, shreddit-comment-tree, shreddit-post");
  }

  OR.scrapeComments = {
    commentFromShredditEl,
    scrapeOpPost,
    forestFromNative,
    materializeMorePartials,
    fetchPartialHtml,
    parseCommentsFromHtml,
    moreStub,
    waitForComments,
  };
})(window.OldReddit);
