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
    const ids = (children || [])
      .map((id) => String(id).replace(/^t1_/, ""))
      .filter(Boolean)
      .slice(0, 100);
    if (!ids.length) return [];
    const body = new URLSearchParams({
      api_type: "json",
      link_id: linkId.startsWith("t3_") ? linkId : `t3_${linkId}`,
      children: ids.join(","),
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

  function cleanUrl(u) {
    if (!u || typeof u !== "string") return null;
    const decoded = u.replace(/&amp;/g, "&").trim();
    if (!/^https?:\/\//i.test(decoded)) return null;
    return decoded;
  }

  function galleryThumbFromMetadata(d) {
    if (!d?.media_metadata) return null;
    const ids = d.gallery_data?.items?.map((i) => i.media_id) || Object.keys(d.media_metadata);
    for (const id of ids) {
      const meta = d.media_metadata[id];
      if (!meta) continue;
      const fromP = meta.p?.length ? meta.p[Math.min(2, meta.p.length - 1)]?.u : null;
      const src = cleanUrl(fromP || meta.s?.u || meta.s?.gif || meta.s?.mp4);
      if (src) return src;
    }
    return null;
  }

  function normalizeLink(d) {
    if (!d || !d.title || d.promoted) return null;

    const postHint = d.post_hint || "";
    const isVideo = !!(d.is_video || postHint === "hosted:video" || d.media?.reddit_video || d.secure_media?.reddit_video);
    const isImage =
      postHint === "image" ||
      /\.(jpg|jpeg|png|gif|webp)$/i.test(d.url || "") ||
      d.domain === "i.redd.it";
    const isGallery = !!(d.is_gallery || d.gallery_data);
    const isSelf = !!d.is_self;

    let postType = "link";
    if (isSelf) postType = "text";
    else if (isGallery) postType = "gallery";
    else if (isVideo) postType = "video";
    else if (isImage) postType = "image";

    const previewImages = d.preview?.images?.[0];
    const previewSource = cleanUrl(previewImages?.source?.url);
    const previewRes = cleanUrl(
      previewImages?.resolutions?.[Math.min(2, (previewImages?.resolutions?.length || 1) - 1)]?.url ||
        previewImages?.resolutions?.[0]?.url
    );
    const thumbField = cleanUrl(d.thumbnail);
    const galleryThumb = galleryThumbFromMetadata(d);
    const thumb = thumbField || previewRes || previewSource || galleryThumb || null;

    let mediaHtml = null;
    let selftextHtml = d.selftext_html || null;
    let selftext = d.selftext || "";

    const redditVideo = d.media?.reddit_video || d.secure_media?.reddit_video;
    if (isVideo && redditVideo) {
      mediaHtml = {
        type: "video",
        fallbackUrl: redditVideo.fallback_url,
        hlsUrl: redditVideo.hls_url,
        width: redditVideo.width,
        height: redditVideo.height,
        poster: previewSource || thumb,
      };
    } else if (isImage) {
      mediaHtml = {
        type: "image",
        url: previewSource || cleanUrl(d.url) || thumb,
      };
    } else if (isGallery && d.media_metadata) {
      const ids = d.gallery_data?.items?.map((i) => i.media_id) || Object.keys(d.media_metadata);
      const items = ids
        .map((id, idx) => {
          const meta = d.media_metadata[id];
          const src = cleanUrl(meta?.s?.u || meta?.s?.gif || meta?.p?.slice(-1)?.[0]?.u);
          const caption = d.gallery_data?.items?.[idx]?.caption || "";
          return src ? { url: src, caption } : null;
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
      created: d.created_utc != null ? d.created_utc * 1000 : null,
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
    // Skip empty stubs from broken morechildren payloads
    if (!d.id && !d.name) return null;
    if (d.author == null && !d.body && !d.body_html) return null;

    let replies = [];
    if (d.replies && typeof d.replies === "object") {
      replies = (d.replies.data?.children || []).map(normalizeThing).filter(Boolean);
    }
    const created =
      d.created_utc != null && Number.isFinite(Number(d.created_utc))
        ? Number(d.created_utc) * 1000
        : null;
    return {
      kind: "comment",
      id: d.name || `t1_${d.id}`,
      commentId: d.id,
      author: d.author || "[deleted]",
      score: d.score ?? 0,
      created,
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

  function imgUrlFromEl(img) {
    if (!img) return null;
    const candidates = [
      img.currentSrc,
      img.getAttribute("src"),
      img.getAttribute("data-lazy-src"),
      img.getAttribute("data-src"),
    ];
    const srcset = img.getAttribute("srcset") || img.getAttribute("data-lazy-srcset") || "";
    if (srcset) {
      // Prefer a mid-size candidate from srcset
      const parts = srcset.split(",").map((s) => s.trim().split(/\s+/)[0]).filter(Boolean);
      if (parts.length) candidates.push(parts[Math.min(1, parts.length - 1)], parts[0]);
    }
    for (const c of candidates) {
      const u = cleanUrl(c);
      if (u && !/avatar|snoovatar|emoji|award|icon/i.test(u)) return u;
    }
    return null;
  }

  function collectImgsDeep(root, out = []) {
    if (!root) return out;
    if (root.querySelectorAll) {
      root.querySelectorAll("img").forEach((img) => out.push(img));
    }
    const walk = root.querySelectorAll ? root.querySelectorAll("*") : [];
    for (const el of walk) {
      if (el.shadowRoot) collectImgsDeep(el.shadowRoot, out);
    }
    if (root.shadowRoot) collectImgsDeep(root.shadowRoot, out);
    return out;
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

    const allImgs = collectImgsDeep(el);
    let thumbnail = null;
    const thumbSlotImg = el.querySelector('[slot="thumbnail"] img');
    thumbnail = imgUrlFromEl(thumbSlotImg);
    if (!thumbnail) {
      for (const img of allImgs) {
        const u = imgUrlFromEl(img);
        if (u && /preview\.redd\.it|i\.redd\.it|external-preview|v\.redd\.it/i.test(u)) {
          thumbnail = u;
          break;
        }
      }
    }
    if (!thumbnail) {
      for (const img of allImgs) {
        const u = imgUrlFromEl(img);
        if (u) {
          thumbnail = u;
          break;
        }
      }
    }

    // Player poster attribute
    if (!thumbnail) {
      const player = el.querySelector("shreddit-player, [poster]");
      const poster = cleanUrl(player?.getAttribute?.("poster"));
      if (poster) thumbnail = poster;
    }

    let selftext = "";
    let selftextHtml = null;
    const textSlot = el.querySelector('[slot="text-body"], shreddit-post-text-body');
    if (textSlot) {
      selftext = textSlot.textContent?.trim() || "";
      selftextHtml = textSlot.innerHTML;
    }

    let media = null;
    const mediaSlot = el.querySelector('[slot="post-media-container"]');
    const mediaImgs = mediaSlot ? collectImgsDeep(mediaSlot) : allImgs;
    const video =
      el.querySelector("video") ||
      (el.shadowRoot && el.shadowRoot.querySelector("video"));
    const player = el.querySelector("shreddit-player");
    if (postType === "video" || video || player) {
      media = {
        type: "video",
        fallbackUrl:
          cleanUrl(player?.getAttribute("src")) ||
          video?.currentSrc ||
          video?.src ||
          contentHref,
        poster: cleanUrl(player?.getAttribute("poster")) || thumbnail,
      };
    } else if (postType === "gallery" || postType === "image") {
      const urls = [];
      for (const img of mediaImgs) {
        const u = imgUrlFromEl(img);
        if (u && !urls.includes(u)) urls.push(u);
      }
      if (urls.length > 1) {
        media = { type: "gallery", items: urls.map((url) => ({ url, caption: "" })) };
      } else if (urls.length === 1) {
        media = { type: "image", url: urls[0] };
      } else if (contentHref) {
        media = { type: postType === "gallery" ? "gallery" : "image", url: contentHref, items: [] };
      }
      if (!thumbnail && urls[0]) thumbnail = urls[0];
    } else if (contentHref && (postType === "image" || postType === "video")) {
      media = { type: postType, url: contentHref, fallbackUrl: contentHref };
    }

    const stickied =
      !!el.querySelector('[slot="title"] svg, [aria-label*="pin" i]') ||
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
