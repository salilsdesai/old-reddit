# Old Reddit

Chrome extension that restyles `reddit.com` subreddit feeds and comment threads to look like classic old Reddit.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for design details.

## Install (unpacked)

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select the `extension/` folder in this repo
4. Visit e.g. `https://www.reddit.com/r/tennis/` or a comments URL

## Supported pages

- `/r/{sub}`, `/r/{sub}/hot|new|rising|top|controversial`
- `/r/{sub}/comments/{id}/{slug}/`

Read-only / logged-out. No sidebar, no ads, expandos on listings, deep comment trees (~6 levels) with “load more comments” stubs.
