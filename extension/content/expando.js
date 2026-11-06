window.OldReddit = window.OldReddit || {};

(function (OR) {
  function decodeHtml(html) {
    if (!html) return "";
    const t = document.createElement("textarea");
    t.innerHTML = html;
    return t.value;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, "&#39;");
  }

  function absoluteVReddit(id, base) {
    if (!base) return null;
    if (/^https?:\/\//i.test(base)) return base;
    return `https://v.redd.it/${id}/${String(base).replace(/^\//, "")}`;
  }

  function postVRedditId(post) {
    return (
      OR.api.vRedditId(post.media?.fallbackUrl) ||
      OR.api.vRedditId(post.media?.url) ||
      OR.api.vRedditId(post.media?.hlsUrl) ||
      OR.api.vRedditId(post.url) ||
      OR.api.vRedditId(post.contentHref)
    );
  }

  /** Reddit hosts video/audio as separate MP4s; resolve both from DASHPlaylist.mpd. */
  async function resolveRedditAv(post) {
    const playable = OR.api.playableVideoUrl;
    let videoUrl = playable(
      post.media?.fallbackUrl,
      post.media?.url,
      post.media?.hlsUrl,
      post.url,
      post.contentHref
    );
    let audioUrl = null;
    const id = postVRedditId(post);

    if (id) {
      try {
        const res = await fetch(`https://v.redd.it/${id}/DASHPlaylist.mpd`, {
          credentials: "omit",
        });
        if (res.ok) {
          const mpd = await res.text();
          const bases = [...mpd.matchAll(/<BaseURL>\s*([^<]+?)\s*<\/BaseURL>/gi)].map((m) =>
            m[1].trim()
          );
          const videos = bases.filter((b) => /^(?:CMAF_|DASH_)\d+/i.test(b) && !/AUDIO/i.test(b));
          const audios = bases.filter(
            (b) => /AUDIO/i.test(b) || /^audio(?:\.mp4)?$/i.test(b)
          );
          const byHeight = (a, b) => {
            const na = Number((a.match(/(\d+)(?:\.mp4)?$/i) || [])[1] || 0);
            const nb = Number((b.match(/(\d+)(?:\.mp4)?$/i) || [])[1] || 0);
            return nb - na;
          };
          const bestV = videos.sort(byHeight)[0];
          const bestA = audios.sort(byHeight)[0];
          if (bestV) videoUrl = absoluteVReddit(id, bestV);
          if (bestA) audioUrl = absoluteVReddit(id, bestA);
        }
      } catch (err) {
        console.warn("[OldReddit] DASH playlist failed", err);
      }

      if (
        !audioUrl &&
        videoUrl &&
        /v\.redd\.it/i.test(videoUrl) &&
        !/packaged-media\.redd\.it/i.test(videoUrl)
      ) {
        if (/CMAF_/i.test(videoUrl)) audioUrl = `https://v.redd.it/${id}/CMAF_AUDIO_128.mp4`;
        else if (/DASH_/i.test(videoUrl)) audioUrl = `https://v.redd.it/${id}/DASH_AUDIO_128.mp4`;
      }
    }

    // Last resort: post JSON fallback_url (often still video-only)
    if (!videoUrl || /\.m3u8(\?|$)/i.test(videoUrl) || /HLSPlaylist/i.test(videoUrl)) {
      try {
        const sub = post.subreddit || "";
        const pid = post.postId || String(post.id || "").replace(/^t3_/, "");
        if (sub && pid) {
          const data = await OR.api.fetchJson(
            `/r/${encodeURIComponent(sub)}/comments/${encodeURIComponent(pid)}.json?limit=1&raw_json=1`
          );
          const d = data?.[0]?.data?.children?.[0]?.data;
          const rv =
            d?.media?.reddit_video ||
            d?.secure_media?.reddit_video ||
            d?.preview?.reddit_video_preview;
          videoUrl =
            playable(rv?.fallback_url, rv?.hls_url, d?.url, videoUrl) || videoUrl;
        }
      } catch (err) {
        console.warn("[OldReddit] video resolve failed", err);
      }
    }

    // Muxed progressive files don't need a companion track
    if (videoUrl && /packaged-media\.redd\.it/i.test(videoUrl)) audioUrl = null;

    return { videoUrl, audioUrl };
  }

  /** Keep a hidden <audio> in lockstep with the (often silent) <video>. */
  function attachCompanionAudio(video, audioUrl) {
    if (!video || !audioUrl) return null;
    const audio = document.createElement("audio");
    audio.className = "or-expando-audio";
    audio.preload = "metadata";
    audio.src = audioUrl;
    audio.setAttribute("playsinline", "");
    video.insertAdjacentElement("afterend", audio);

    const syncMute = () => {
      audio.muted = video.muted;
      audio.volume = video.volume;
    };
    video.addEventListener("play", () => {
      syncMute();
      try {
        audio.currentTime = video.currentTime;
      } catch (_) {}
      audio.play().catch(() => {});
    });
    video.addEventListener("pause", () => {
      try {
        audio.pause();
      } catch (_) {}
    });
    video.addEventListener("seeking", () => {
      try {
        audio.currentTime = video.currentTime;
      } catch (_) {}
    });
    video.addEventListener("ratechange", () => {
      audio.playbackRate = video.playbackRate;
    });
    video.addEventListener("volumechange", syncMute);
    video.addEventListener("timeupdate", () => {
      if (video.paused) return;
      if (Math.abs((audio.currentTime || 0) - video.currentTime) > 0.35) {
        try {
          audio.currentTime = video.currentTime;
        } catch (_) {}
      }
      if (audio.paused) audio.play().catch(() => {});
    });
    audio.addEventListener("error", () => {
      try {
        audio.remove();
      } catch (_) {}
    });
    return audio;
  }

  function setExpandoContent(container, post) {
    container.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "expando-content usertext-body";

    const isVideo = post.postType === "video" || post.media?.type === "video";
    const isEmbed = post.media?.type === "embed";

    if (post.postType === "text" || (post.selftext && !post.media && !isVideo)) {
      if (post.selftextHtml) {
        wrap.innerHTML = decodeHtml(post.selftextHtml);
      } else if (post.selftext) {
        const pre = document.createElement("div");
        pre.className = "md";
        pre.textContent = post.selftext;
        wrap.appendChild(pre);
      } else {
        wrap.innerHTML = `<div class="md"><p><em>(no text)</em></p></div>`;
      }
    } else if (isEmbed) {
      const box = document.createElement("div");
      box.className = "or-embed";
      const raw = post.media.html || "";
      box.innerHTML = /&lt;\s*iframe/i.test(raw) ? decodeHtml(raw) : raw;
      box.querySelectorAll("iframe").forEach((iframe) => {
        iframe.style.maxWidth = "100%";
        iframe.width = iframe.width || "640";
        iframe.height = iframe.height || "360";
        iframe.setAttribute("allowfullscreen", "");
      });
      wrap.appendChild(box);
    } else if (isVideo) {
      const video = document.createElement("video");
      video.className = "or-expando-video";
      video.controls = true;
      video.playsInline = true;
      video.preload = "metadata";
      if (post.media?.poster) video.poster = post.media.poster;
      else if (post.thumbnail) video.poster = post.thumbnail;

      const tentative = playableFromPost(post);
      if (tentative) video.src = tentative;
      wrap.appendChild(video);

      const status = document.createElement("p");
      status.className = "or-video-status";
      status.style.cssText = "color:#888;font-size:x-small;margin:4px 0 0;";
      if (!tentative) status.textContent = "Loading video…";
      wrap.appendChild(status);

      resolveRedditAv(post).then(({ videoUrl, audioUrl }) => {
        if (!video.isConnected) return;
        if (!videoUrl) {
          status.textContent = "Video unavailable";
          return;
        }
        if (video.src !== videoUrl) video.src = videoUrl;
        attachCompanionAudio(video, audioUrl);
        status.remove();
      });
    } else if (post.media?.type === "image") {
      const img = document.createElement("img");
      img.className = "or-expando-image";
      img.src = post.media.url;
      img.alt = post.title || "";
      wrap.appendChild(img);
    } else if (post.media?.type === "gallery") {
      for (const item of post.media.items || []) {
        const img = document.createElement("img");
        img.className = "or-expando-image";
        img.src = item.url;
        img.alt = item.caption || post.title || "";
        wrap.appendChild(img);
        if (item.caption) {
          const cap = document.createElement("p");
          cap.className = "or-gallery-caption";
          cap.textContent = item.caption;
          wrap.appendChild(cap);
        }
      }
    } else if (post.url && post.postType === "link") {
      // Link posts: preview already covers media; no extra "open" chrome
      wrap.innerHTML = "";
    } else {
      wrap.innerHTML = "";
    }

    container.appendChild(wrap);
  }

  function playableFromPost(post) {
    return OR.api.playableVideoUrl(
      post.media?.fallbackUrl,
      post.media?.url,
      post.media?.hlsUrl,
      post.url
    );
  }

  function canExpand(post) {
    if (!post) return false;
    if (post.postType === "text") return !!(post.selftext || post.selftextHtml);
    if (post.media) return true;
    if (post.postType === "video") return true;
    if (post.postType === "link" && post.url && !String(post.url).includes(post.permalink)) return true;
    return ["image", "video", "gallery"].includes(post.postType);
  }

  function expandoClass(post) {
    if (post.postType === "text") return "selftext";
    if (post.postType === "video" || post.media?.type === "video" || post.media?.type === "embed") return "video";
    if (post.postType === "image" || post.postType === "gallery") return "image";
    return "selftext";
  }

  /** Hard-stop playback; each step is isolated so one failure can't skip the rest. */
  function stopMedia(root) {
    if (!root) return;
    root.querySelectorAll("video, audio").forEach((el) => {
      try {
        el.pause();
      } catch (_) {}
      try {
        el.muted = true;
        el.volume = 0;
      } catch (_) {}
      try {
        el.removeAttribute("src");
        el.querySelectorAll("source").forEach((s) => s.remove());
        el.load();
      } catch (_) {}
    });
    // Embeds (YouTube etc.) keep audio unless the iframe is blanked
    root.querySelectorAll("iframe").forEach((iframe) => {
      try {
        iframe.src = "about:blank";
      } catch (_) {}
    });
  }

  /** Shreddit is parked off-screen but can still autoplay; keep it silent. */
  function silenceForeignMedia() {
    document.querySelectorAll("video, audio").forEach((el) => {
      if (el.closest("#old-reddit-root")) return;
      try {
        el.pause();
        el.muted = true;
        el.volume = 0;
      } catch (_) {}
    });
  }

  function bindExpando(button, expando, post) {
    button.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const collapsed = button.classList.contains("collapsed");
      if (collapsed) {
        button.classList.remove("collapsed");
        button.classList.add("expanded");
        button.title = "minimize preview";
        // Always rebuild so a prior hard-stop can't leave a half-dead player
        setExpandoContent(expando, post);
        expando.dataset.ready = "1";
        expando.style.display = "block";
      } else {
        button.classList.add("collapsed");
        button.classList.remove("expanded");
        button.title = "expand";
        stopMedia(expando);
        // Destroy nodes so the media pipeline cannot keep running while hidden
        expando.innerHTML = "";
        delete expando.dataset.ready;
        expando.style.display = "none";
        silenceForeignMedia();
      }
    });
  }

  OR.expando = {
    canExpand,
    expandoClass,
    setExpandoContent,
    bindExpando,
    silenceForeignMedia,
    decodeHtml,
    escapeHtml,
    escapeAttr,
  };
})(window.OldReddit);
