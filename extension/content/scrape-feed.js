window.OldReddit = window.OldReddit || {};

(function (OR) {
  function collectFeedPosts(root = document) {
    const els = [
      ...root.querySelectorAll("shreddit-post"),
    ];
    const seen = new Set();
    const posts = [];
    for (const el of els) {
      if (el.closest("shreddit-ad-post")) continue;
      const post = OR.api.postFromShredditEl(el);
      if (!post || seen.has(post.id)) continue;
      seen.add(post.id);
      posts.push(post);
    }
    return posts;
  }

  function observeFeed(onPosts, { root = document } = {}) {
    const seen = new Set();

    const ingest = () => {
      const posts = collectFeedPosts(root).filter((p) => {
        if (seen.has(p.id)) return false;
        seen.add(p.id);
        return true;
      });
      if (posts.length) onPosts(posts);
    };

    ingest();

    const observer = new MutationObserver(() => ingest());
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    // Also nudge Shreddit scroll loading by scrolling the (hidden) window periodically
    // when our visible root nears the bottom — handled by caller via ensureScrollLoading.

    return {
      disconnect() {
        observer.disconnect();
      },
      markSeen(id) {
        seen.add(id);
      },
      has(id) {
        return seen.has(id);
      },
    };
  }

  /**
   * Formerly drove Shreddit's infinite scroll by jerking the window scroll
   * position near the bottom. That cannot work anymore: the Shreddit feed
   * is parked at 1px off-screen, so its IntersectionObserver never fires,
   * and the scrollTo-back step fought the user's own scrolling. Pagination
   * is now driven by the feed's own JSON / Shreddit endpoints (render-feed
   * loadMore). Kept as a no-op for API compatibility; no longer called.
   */
  function bindInfiniteScrollBridge(_getNearBottom) {
    return () => {};
  }

  OR.scrapeFeed = { collectFeedPosts, observeFeed, bindInfiniteScrollBridge };
})(window.OldReddit);
