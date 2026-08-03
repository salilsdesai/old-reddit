(() => {
  const path = location.pathname;
  // /r/{sub}[/], /r/{sub}/{sort}[/], /r/{sub}/comments/{id}/...
  const listingOrComments =
    /^\/r\/[^/]+\/?$/i.test(path) ||
    /^\/r\/[^/]+\/(hot|new|rising|top|controversial)\/?$/i.test(path) ||
    /^\/r\/[^/]+\/comments\/[^/]+/i.test(path);

  if (!listingOrComments) return;
  if (/\/r\/[^/]+\/(wiki|about|rules|mod|search|submit|gallery)\b/i.test(path)) return;

  document.documentElement.classList.add("old-reddit-pending");
})();
