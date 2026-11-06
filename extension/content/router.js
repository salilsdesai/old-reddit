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
      const params = new URLSearchParams(url.search);
      const sortRaw = (params.get("sort") || "confidence").toLowerCase();
      const sortMap = {
        best: "confidence",
        confidence: "confidence",
        top: "top",
        new: "new",
        controversial: "controversial",
        old: "old",
        qa: "qa",
        "q&a": "qa",
      };
      let slug = parts[4] || "";
      let focusCommentId = null;
      // /r/sub/comments/{post}/comment/{id}/  or  /r/sub/comments/{post}/{slug}/{id}/
      if (parts[4] === "comment" && parts[5]) {
        focusCommentId = parts[5];
        slug = "comment";
      } else if (parts[5]) {
        focusCommentId = parts[5];
      }
      return {
        type: "comments",
        subreddit,
        postId: parts[3],
        slug,
        focusCommentId,
        commentSort: sortMap[sortRaw] || "confidence",
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
