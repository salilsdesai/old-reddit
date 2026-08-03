window.OldReddit = window.OldReddit || {};

(function (OR) {
  function decodeHtml(html) {
    if (!html) return "";
    const t = document.createElement("textarea");
    t.innerHTML = html;
    return t.value;
  }

  function setExpandoContent(container, post) {
    container.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "expando-content usertext-body";

    if (post.postType === "text" || (post.selftext && !post.media)) {
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
    } else if (post.media?.type === "video") {
      const video = document.createElement("video");
      video.className = "or-expando-video";
      video.controls = true;
      video.playsInline = true;
      if (post.media.poster) video.poster = post.media.poster;
      video.src = post.media.fallbackUrl || post.media.url || "";
      wrap.appendChild(video);
      if (!video.src && post.url) {
        const a = document.createElement("a");
        a.href = post.url;
        a.textContent = "Open media";
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        wrap.appendChild(a);
      }
    } else if (post.url && post.postType === "link") {
      wrap.innerHTML = `<div class="md"><p><a href="${escapeAttr(post.url)}" target="_blank" rel="noopener noreferrer ugc">${escapeHtml(post.url)}</a></p></div>`;
    } else {
      wrap.innerHTML = `<div class="md"><p><a href="${escapeAttr(post.permalink)}">Open post</a></p></div>`;
    }

    container.appendChild(wrap);
  }

  function canExpand(post) {
    if (!post) return false;
    if (post.postType === "text") return !!(post.selftext || post.selftextHtml);
    if (post.media) return true;
    if (post.postType === "link" && post.url && !String(post.url).includes(post.permalink)) return true;
    // Try expanding anything with a non-default thumb domain media
    return ["image", "video", "gallery"].includes(post.postType);
  }

  function expandoClass(post) {
    if (post.postType === "text") return "selftext";
    if (post.postType === "video") return "video";
    if (post.postType === "image" || post.postType === "gallery") return "image";
    return "selftext";
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

  function bindExpando(button, expando, post) {
    button.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const collapsed = button.classList.contains("collapsed");
      if (collapsed) {
        button.classList.remove("collapsed");
        button.classList.add("expanded");
        if (!expando.dataset.ready) {
          setExpandoContent(expando, post);
          expando.dataset.ready = "1";
        }
        expando.style.display = "block";
      } else {
        button.classList.add("collapsed");
        button.classList.remove("expanded");
        expando.style.display = "none";
      }
    });
  }

  OR.expando = { canExpand, expandoClass, setExpandoContent, bindExpando, decodeHtml, escapeHtml, escapeAttr };
})(window.OldReddit);
