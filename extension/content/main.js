(() => {
  const OR = window.OldReddit;
  if (!OR) return;

  let cleanup = null;
  let lastKey = "";

  function routeKey(r = OR.router.detect()) {
    if (r.type === "ignore") return "ignore:" + location.pathname;
    if (r.type === "feed") return `feed:${r.subreddit}:${r.sort}:${r.t || ""}`;
    if (r.type === "comments") {
      return `comments:${r.subreddit}:${r.postId}:${r.focusCommentId || ""}:${r.commentSort || "confidence"}`;
    }
    return location.pathname + location.search;
  }

  async function boot(reason = "init") {
    const r = OR.router.detect();
    const key = routeKey(r);
    if (key === lastKey && reason !== "init") return;
    lastKey = key;

    if (cleanup) {
      try {
        cleanup();
      } catch (_) {}
      cleanup = null;
    }

    if (r.type === "ignore") {
      document.documentElement.classList.remove(
        "old-reddit-pending",
        "old-reddit-active",
        "or-comments-mode",
        "or-feed-mode"
      );
      const root = document.getElementById("old-reddit-root");
      if (root) root.remove();
      return;
    }

    console.info("[OldReddit] boot", reason, r);
    if (r.type === "feed") {
      cleanup = (await OR.renderFeed.mountFeed(r)) || null;
    } else if (r.type === "comments") {
      cleanup = (await OR.renderComments.mountComments(r)) || null;
    }
  }

  function navigateCommentsHref(href) {
    let url;
    try {
      url = new URL(href, location.origin);
    } catch (_) {
      return false;
    }
    const host = (h) => String(h || "").replace(/^www\./i, "").toLowerCase();
    if (host(url.hostname) !== host(location.hostname) && !/reddit\.com$/i.test(url.hostname)) {
      return false;
    }
    if (!/^\/r\/[^/]+\/comments\//i.test(url.pathname)) return false;
    if (/\/comment\/[^/]+/i.test(url.pathname) && !url.searchParams.has("force-legacy-sct")) {
      url.searchParams.set("force-legacy-sct", "1");
    }
    const destPath = url.pathname.replace(/\/+$/, "");
    const herePath = location.pathname.replace(/\/+$/, "");
    // Reddit's SPA often pushState's this URL and scrollIntoView the hidden
    // Shreddit comment. If the path already matches, force a real reload so
    // the focused comment tree is actually served.
    if (destPath === herePath) location.reload();
    else location.href = url.pathname + url.search;
    return true;
  }

  // Content scripts run at document_idle, so Reddit's capture handler usually
  // runs first and may already have preventDefault'd / pushState'd.
  document.addEventListener(
    "click",
    (e) => {
      if (e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest?.("#old-reddit-root a[href]");
      if (!a || (a.target && a.target !== "_self")) return;
      const href = a.getAttribute("href");
      if (!href || href === "#" || href.startsWith("javascript:")) return;
      let probe;
      try {
        probe = new URL(href, location.origin);
      } catch (_) {
        return;
      }
      if (!/^\/r\/[^/]+\/comments\//i.test(probe.pathname)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      navigateCommentsHref(href);
    },
    true
  );

  boot("init");

  const wrap = (fn) =>
    function patched(...args) {
      const ret = fn.apply(this, args);
      queueMicrotask(() => boot("history"));
      return ret;
    };
  history.pushState = wrap(history.pushState.bind(history));
  history.replaceState = wrap(history.replaceState.bind(history));
  window.addEventListener("popstate", () => boot("popstate"));

  setInterval(() => {
    boot("poll");
    if (
      document.documentElement.classList.contains("old-reddit-active") &&
      OR.expando?.silenceForeignMedia
    ) {
      OR.expando.silenceForeignMedia();
    }
  }, 1000);
})();
