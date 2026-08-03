window.OldReddit = window.OldReddit || {};

(function (OR) {
  function createRoot() {
    let root = document.getElementById("old-reddit-root");
    if (!root) {
      root = document.createElement("div");
      root.id = "old-reddit-root";
      document.documentElement.appendChild(root);
      if (document.body) {
        document.body.appendChild(root);
      } else {
        document.addEventListener("DOMContentLoaded", () => {
          if (root.parentElement !== document.body) document.body.appendChild(root);
        });
      }
    }
    document.documentElement.classList.add("old-reddit-active");
    document.documentElement.classList.remove("old-reddit-pending");
    return root;
  }

  const TOP_TIMES = [
    { value: "hour", label: "past hour" },
    { value: "day", label: "past 24 hours" },
    { value: "week", label: "past week" },
    { value: "month", label: "past month" },
    { value: "year", label: "past year" },
    { value: "all", label: "all time" },
  ];

  const COMMENT_SORTS = [
    { value: "confidence", label: "best" },
    { value: "top", label: "top" },
    { value: "new", label: "new" },
    { value: "controversial", label: "controversial" },
    { value: "old", label: "old" },
    { value: "qa", label: "q&a" },
  ];

  function bindTopTimeSelect(root, subreddit) {
    const topSelect = root.querySelector("#or-top-time");
    if (!topSelect) return;
    topSelect.addEventListener("change", () => {
      const next = topSelect.value;
      location.assign(`/r/${encodeURIComponent(subreddit)}/top/?t=${encodeURIComponent(next)}`);
    });
  }

  function bindCommentSortSelect(root) {
    const sortSelect = root.querySelector("#or-comment-sort");
    if (!sortSelect) return;
    sortSelect.addEventListener("change", () => {
      const url = new URL(location.href);
      url.searchParams.set("sort", sortSelect.value);
      location.assign(url.toString());
    });
  }

  function commentSortMenuHtml(commentSort) {
    const options = COMMENT_SORTS.map(
      (opt) =>
        `<option value="${opt.value}" ${opt.value === commentSort ? "selected" : ""}>${opt.label}</option>`
    ).join("");
    return `
      <div class="or-menu-bar">
        <label class="or-dropdown-label">sorted by:
          <select id="or-comment-sort" class="or-dropdown">${options}</select>
        </label>
      </div>`;
  }

  function renderShell(root, { subreddit, sort = "hot", t = null, mode, commentSort = "confidence" }) {
    const tabs = ["hot", "new", "rising", "controversial", "top"];
    const tabHtml = tabs
      .map((name) => {
        const selected = mode === "feed" && name === sort ? ' class="selected"' : "";
        let href = `/r/${encodeURIComponent(subreddit)}/${name}/`;
        if (name === "top") {
          const tv = t || "day";
          href += `?t=${encodeURIComponent(tv)}`;
        }
        return `<li${selected}><a href="${href}">${name}</a></li>`;
      })
      .join("");

    let extraMenus = "";
    if (mode === "feed" && sort === "top") {
      const current = t || "day";
      const options = TOP_TIMES.map(
        (opt) =>
          `<option value="${opt.value}" ${opt.value === current ? "selected" : ""}>${opt.label}</option>`
      ).join("");
      extraMenus = `
        <div class="or-menu-bar">
          <label class="or-dropdown-label">links from
            <select id="or-top-time" class="or-dropdown">${options}</select>
          </label>
        </div>`;
    }

    const tabmenuHtml =
      mode === "feed" ? `<ul class="tabmenu">${tabHtml}</ul>` : "";

    root.innerHTML = `
      <div id="header" role="banner">
        <div id="header-bottom-left">
          <a href="/r/${OR.expando.escapeAttr(subreddit)}/" id="header-img-a" title="reddit.com">
            <span id="header-img" class="default-header" role="presentation">reddit</span>
          </a>
          <span class="hover pagename redditname">
            <a href="/r/${OR.expando.escapeAttr(subreddit)}/">r/${OR.expando.escapeHtml(subreddit)}</a>
          </span>
          ${tabmenuHtml}
        </div>
      </div>
      <div class="or-status" id="or-status" hidden></div>
      ${extraMenus}
      <div class="content" role="main">
        <div id="siteTable" class="sitetable ${mode === "comments" ? "nestedlisting" : "linklisting"}"></div>
      </div>
    `;

    bindTopTimeSelect(root, subreddit);

    return {
      siteTable: root.querySelector("#siteTable"),
      status: root.querySelector("#or-status"),
      commentSort,
      commentSortMenuHtml: () => commentSortMenuHtml(commentSort),
      bindCommentSortSelect: () => bindCommentSortSelect(root),
    };
  }

  function setStatus(el, message, { error = false } = {}) {
    if (!el) return;
    if (!message) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    el.hidden = false;
    el.textContent = message;
    el.classList.toggle("or-status-error", error);
  }

  OR.shell = {
    createRoot,
    renderShell,
    setStatus,
    TOP_TIMES,
    COMMENT_SORTS,
    commentSortMenuHtml,
    bindCommentSortSelect,
  };
})(window.OldReddit);
