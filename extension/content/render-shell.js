window.OldReddit = window.OldReddit || {};

(function (OR) {
  function createRoot() {
    let root = document.getElementById("old-reddit-root");
    if (!root) {
      root = document.createElement("div");
      root.id = "old-reddit-root";
      document.documentElement.appendChild(root);
      // Prefer body once available
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

  function renderShell(root, { subreddit, sort = "hot", t = null, mode }) {
    const tabs = ["hot", "new", "rising", "controversial", "top"];
    const tabHtml = tabs
      .map((name) => {
        const selected = name === sort ? " class=\"selected\"" : "";
        let href = `/r/${encodeURIComponent(subreddit)}/${name}/`;
        if (name === "top" && t) href += `?t=${encodeURIComponent(t)}`;
        return `<li${selected}><a href="${href}">${name}</a></li>`;
      })
      .join("");

    root.innerHTML = `
      <div id="header" role="banner">
        <div id="header-bottom-left">
          <a href="/" id="header-img-a" title="reddit.com">
            <span id="header-img" class="default-header" role="presentation">reddit</span>
          </a>
          <span class="hover pagename redditname">
            <a href="/r/${OR.expando.escapeAttr(subreddit)}/">r/${OR.expando.escapeHtml(subreddit)}</a>
          </span>
          <ul class="tabmenu">${tabHtml}</ul>
        </div>
        <div id="header-bottom-right">
          <span class="user">want to join? <a href="https://www.reddit.com/login/" class="login-required login-link">log in</a> or <a href="https://www.reddit.com/register/">sign up</a></span>
        </div>
      </div>
      <div class="or-status" id="or-status" hidden></div>
      <div class="content" role="main">
        <div id="siteTable" class="sitetable ${mode === "comments" ? "nestedlisting" : "linklisting"}"></div>
      </div>
    `;

    return {
      siteTable: root.querySelector("#siteTable"),
      status: root.querySelector("#or-status"),
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

  OR.shell = { createRoot, renderShell, setStatus };
})(window.OldReddit);
