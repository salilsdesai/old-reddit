window.OldReddit = window.OldReddit || {};

(function (OR) {
  async function fetchJson(url) {
    const res = await fetch(url, {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for ${url}`);
    }
    return res.json();
  }

  function listingUrl({ subreddit, sort = "hot", after = null, t = null, limit = 25 }) {
    const base = `/r/${encodeURIComponent(subreddit)}/${sort}.json`;
    const params = new URLSearchParams({ raw_json: "1", limit: String(limit) });
    if (after) params.set("after", after);
    if (t && (sort === "top" || sort === "controversial")) params.set("t", t);
    return `${base}?${params}`;
  }

  function commentsUrl({ subreddit, postId, sort = "confidence", limit = 200, depth = 6 }) {
    const params = new URLSearchParams({
      raw_json: "1",
      limit: String(limit),
      depth: String(depth),
      sort,
    });
    return `/r/${encodeURIComponent(subreddit)}/comments/${encodeURIComponent(postId)}.json?${params}`;
  }

  async function fetchListing(opts) {
    const data = await fetchJson(listingUrl(opts));
    const listing = Array.isArray(data) ? data[0] : data;
    const children = listing?.data?.children || [];
    return {
      posts: children
        .filter((c) => c.kind === "t3")
        .map((c) => normalizeLink(c.data))
        .filter((p) => p && !p.promoted),
      after: listing?.data?.after || null,
    };
  }

  async function fetchComments(opts) {
    const data = await fetchJson(commentsUrl(opts));
    const postListing = data[0];
    const commentListing = data[1];
    const post = normalizeLink(postListing?.data?.children?.[0]?.data);
    const comments = (commentListing?.data?.children || []).map(normalizeThing).filter(Boolean);
    return { post, comments };
  }

  async function fetchMoreChildren({ linkId, children, sort = "confidence", depth = 6 }) {
    const body = new URLSearchParams({
      api_type: "json",
      link_id: linkId,
      children: children.join(","),
      sort,
      raw_json: "1",
      depth: String(depth),
    });
    const res = await fetch("/api/morechildren", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
    });
    if (!res.ok) throw new Error(`morechildren HTTP ${res.status}`);
    const json = await res.json();
    const things = json?.json?.data?.things || [];
    return things.map(normalizeThing).filter(Boolean);
  }

  function normalizeLink(d) {
    if (!d || !d.title || d.promoted) return null;

    const postHint = d.post_hint || "";
    const isVideo = !!(d.is_video || postHint === "hosted:video" || d.media?.reddit_video);
    const isImage =
      postHint === "image" ||
      /\.(jpg|jpeg|png|gif|webp)$/i.test(d.url || "") ||
      (d.domain === "i.redd.it");
    const isGallery = !!(d.is_gallery || d.gallery_data);
    const isSelf = !!d.is_self;

    let postType = "link";
    if (isSelf) postType = "text";
    else if (isGallery) postType = "gallery";
    else if (isVideo) postType = "video";
    else if (isImage) postType = "image";

    const previewImages = d.preview?.images?.[0];
    const thumb =
      (typeof d.thumbnail === "string" && d.thumbnail.startsWith("http") && d.thumbnail) ||
      previewImages?.resolutions?.[0]?.url ||
      previewImages?.source?.url ||
      null;

    let mediaHtml = null;
    let selftextHtml = d.selftext_html || null;
    let selftext = d.selftext || "";

    if (isVideo && d.media?.reddit_video) {
      const v = d.media.reddit_video;
      mediaHtml = {
        type: "video",
        fallbackUrl: v.fallback_url,
        hlsUrl: v.hls_url,
        width: v.width,
        height: v.height,
        poster: previewImages?.source?.url || thumb,
      };
    } else if (isImage) {
      mediaHtml = {
        type: "image",
        url: previewImages?.source?.url || d.url,
      };
    } else if (isGallery && d.gallery_data && d.media_metadata) {
      const items = d.gallery_data.items
        .map((item) => {
          const meta = d.media_metadata[item.media_id];
          const src = meta?.s?.u || meta?.s?.gif || null;
          return src ? { url: src.replace(/&amp;/g, "&"), caption: item.caption || "" } : null;
        })
        .filter(Boolean);
      mediaHtml = { type: "gallery", items };
    }

    return {
      id: d.name || `t3_${d.id}`,
      postId: d.id,
      title: d.title,
      author: d.author,
      score: d.score,
      upvoteRatio: d.upvote_ratio,
      commentCount: d.num_comments,
      created: d.created_utc * 1000,
      permalink: d.permalink,
      url: d.url,
      domain: d.domain,
      subreddit: d.subreddit,
      stickied: !!d.stickied,
      nsfw: !!d.over_18,
      spoiler: !!d.spoiler,
      flair: d.link_flair_text,
      flairColor: d.link_flair_background_color,
      postType,
      thumbnail: thumb,
      selftext,
      selftextHtml,
      media: mediaHtml,
      promoted: !!d.promoted,
    };
  }

  function normalizeThing(thing) {
    if (!thing) return null;
    if (thing.kind === "more") {
      return {
        kind: "more",
        id: thing.data?.id || "more",
        count: thing.data?.count || 0,
        children: thing.data?.children || [],
        depth: thing.data?.depth || 0,
        parentId: thing.data?.parent_id,
      };
    }
    if (thing.kind === "t1") {
      return normalizeComment(thing.data);
    }
    if (thing.kind === "t3") {
      return normalizeLink(thing.data);
    }
    return null;
  }

  function normalizeComment(d) {
    if (!d) return null;
    let replies = [];
    if (d.replies && typeof d.replies === "object") {
      replies = (d.replies.data?.children || []).map(normalizeThing).filter(Boolean);
    }
    return {
      kind: "comment",
      id: d.name || `t1_${d.id}`,
      commentId: d.id,
      author: d.author,
      score: d.score,
      created: d.created_utc * 1000,
      body: d.body || "",
      bodyHtml: d.body_html || "",
      permalink: d.permalink,
      depth: d.depth || 0,
      parentId: d.parent_id,
      stickied: !!d.stickied,
      isSubmitter: !!d.is_submitter,
      replies,
    };
  }

  /** Convert a scraped shreddit-post element into our post model (partial). */
  function postFromShredditEl(el) {
    if (!el || el.tagName?.toLowerCase() === "shreddit-ad-post") return null;
    const id = el.getAttribute("id") || el.getAttribute("post-id");
    if (!id || !id.startsWith("t3_")) return null;

    const postType = (el.getAttribute("post-type") || "link").toLowerCase();
    const permalink = el.getAttribute("permalink") || "";
    const title =
      el.getAttribute("post-title") ||
      el.querySelector('[slot="title"]')?.textContent?.trim() ||
      "";
    if (!title) return null;

    const score = Number(el.getAttribute("score") || 0);
    const commentCount = Number(el.getAttribute("comment-count") || 0);
    const author = el.getAttribute("author") || "[deleted]";
    const created = el.getAttribute("created-timestamp") || "";
    const domain = el.getAttribute("domain") || "reddit.com";
    const contentHref = el.getAttribute("content-href") || "";
    const subreddit =
      el.getAttribute("subreddit-name") ||
      el.getAttribute("subreddit-prefixed-name")?.replace(/^r\//, "") ||
      "";

    let thumbnail = null;
    const thumbImg =
      el.querySelector('[slot="thumbnail"] img') ||
      el.querySelector("img[src*='preview'], img[src*='i.redd'], img[src*='external-preview']");
    if (thumbImg?.src) thumbnail = thumbImg.src;

    let selftext = "";
    let selftextHtml = null;
    const textSlot = el.querySelector('[slot="text-body"], shreddit-post-text-body');
    if (textSlot) {
      selftext = textSlot.textContent?.trim() || "";
      selftextHtml = textSlot.innerHTML;
    }

    let media = null;
    const mediaSlot = el.querySelector('[slot="post-media-container"]');
    if (mediaSlot) {
      const img = mediaSlot.querySelector("img");
      const video = mediaSlot.querySelector("video");
      if (video) {
        media = {
          type: "video",
          fallbackUrl: video.currentSrc || video.src || contentHref,
          poster: video.getAttribute("poster") || img?.src || thumbnail,
        };
      } else if (img) {
        media = { type: "image", url: img.currentSrc || img.src };
        if (!thumbnail) thumbnail = img.src;
      } else if (contentHref) {
        media = { type: postType === "video" ? "video" : "image", url: contentHref, fallbackUrl: contentHref };
      }
    } else if (contentHref && (postType === "image" || postType === "video")) {
      media = {
        type: postType,
        url: contentHref,
        fallbackUrl: contentHref,
      };
    }

    const stickied = !!el.querySelector('[slot="title"] svg, [aria-label*="pin" i]') ||
      el.hasAttribute("pinned") ||
      el.getAttribute("distinguish-type") === "sticky";

    return {
      id,
      postId: id.replace(/^t3_/, ""),
      title,
      author,
      score,
      commentCount,
      created,
      permalink,
      url: contentHref || permalink,
      domain,
      subreddit,
      stickied,
      nsfw: el.hasAttribute("nsfw") || el.getAttribute("nsfw") === "true",
      spoiler: el.hasAttribute("spoiler"),
      flair: el.querySelector('[slot="post-flair"]')?.textContent?.trim() || null,
      flairColor: null,
      postType,
      thumbnail,
      selftext,
      selftextHtml,
      media,
      promoted: false,
      _source: "dom",
    };
  }

  OR.api = {
    fetchJson,
    fetchListing,
    fetchComments,
    fetchMoreChildren,
    listingUrl,
    commentsUrl,
    normalizeLink,
    normalizeComment,
    normalizeThing,
    postFromShredditEl,
  };
})(window.OldReddit);
