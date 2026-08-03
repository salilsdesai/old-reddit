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
   * Drive Shreddit's infinite scroll while our UI is shown.
   * Scrolls the real window; Shreddit remains in DOM (hidden) and should fetch more.
   */
  function bindInfiniteScrollBridge(getNearBottom) {
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        if (!getNearBottom()) return;
        // Nudge native scroll height consumers
        const sh = document.documentElement.scrollHeight;
        window.dispatchEvent(new Event("scroll"));
        // Force a tiny scroll on the hidden feed container if present
        const feed = document.querySelector("shreddit-feed, #main-content, faceplate-tracker");
        if (feed) {
          feed.dispatchEvent(new Event("scroll", { bubbles: true }));
        }
        // As fallback, briefly reveal scroll by setting scrollTop
        const prev = window.scrollY;
        window.scrollTo(0, Math.max(prev, sh - window.innerHeight - 10));
        window.scrollTo(0, prev);
      });
    };
    document.addEventListener("scroll", onScroll, { passive: true });
    return () => document.removeEventListener("scroll", onScroll);
  }

  OR.scrapeFeed = { collectFeedPosts, observeFeed, bindInfiniteScrollBridge };
})(window.OldReddit);
