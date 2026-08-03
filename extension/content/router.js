window.OldReddit = window.OldReddit || {};

(function (OR) {
  const LISTING_SORTS = new Set(["hot", "new", "rising", "top", "controversial"]);

  function detect(url = location) {
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const parts = path.split("/").filter(Boolean);
    // parts: ["r", sub, ...]
    if (parts.length < 2 || parts[0].toLowerCase() !== "r") {
      return { type: "ignore" };
    }
    const subreddit = parts[1];
    if (!subreddit) return { type: "ignore" };

    if (parts[2] === "comments" && parts[3]) {
      return {
        type: "comments",
        subreddit,
        postId: parts[3],
        slug: parts[4] || "",
        permalink: `/r/${subreddit}/comments/${parts[3]}/${parts[4] || ""}`.replace(/\/$/, "/"),
      };
    }

    // Skip unsupported sub-paths
    if (parts[2] && !LISTING_SORTS.has(parts[2].toLowerCase())) {
      return { type: "ignore" };
    }

    const sort = parts[2] ? parts[2].toLowerCase() : "hot";
    const params = new URLSearchParams(url.search);
    return {
      type: "feed",
      subreddit,
      sort,
      t: params.get("t") || (sort === "top" || sort === "controversial" ? "day" : null),
    };
  }

  OR.router = { detect, LISTING_SORTS };
})(window.OldReddit);
