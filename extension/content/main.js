(() => {
  const OR = window.OldReddit;
  if (!OR) return;

  let cleanup = null;
  let lastKey = "";

  function routeKey(r = OR.router.detect()) {
    if (r.type === "ignore") return "ignore:" + location.pathname;
    if (r.type === "feed") return `feed:${r.subreddit}:${r.sort}:${r.t || ""}`;
    if (r.type === "comments") return `comments:${r.subreddit}:${r.postId}`;
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
      document.documentElement.classList.remove("old-reddit-pending", "old-reddit-active");
      const root = document.getElementById("old-reddit-root");
      if (root) root.remove();
      return;
    }

    console.info("[OldReddit] boot", reason, r);
    if (r.type === "feed") {
      cleanup = (await OR.renderFeed.mountFeed(r)) || null;
    } else if (r.type === "comments") {
      await OR.renderComments.mountComments(r);
    }
  }

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

  setInterval(() => boot("poll"), 1000);
})();
