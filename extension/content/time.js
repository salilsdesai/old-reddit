window.OldReddit = window.OldReddit || {};

(function (OR) {
  function parseTimestamp(value) {
    if (value == null || value === "") return null;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return null;
      return value < 1e12 ? value * 1000 : value;
    }
    const n = Number(value);
    if (!Number.isNaN(n) && String(value).trim() !== "" && Number.isFinite(n)) {
      return n < 1e12 ? n * 1000 : n;
    }
    const d = Date.parse(value);
    return Number.isNaN(d) ? null : d;
  }

  function relativeTime(value) {
    const ms = parseTimestamp(value);
    if (ms == null || !Number.isFinite(ms)) return "";
    const seconds = Math.max(0, Math.floor((Date.now() - ms) / 1000));
    if (!Number.isFinite(seconds)) return "";
    const table = [
      [60, "second"],
      [60, "minute"],
      [24, "hour"],
      [30, "day"],
      [12, "month"],
      [Number.POSITIVE_INFINITY, "year"],
    ];
    let n = seconds;
    let unit = "second";
    for (const [div, name] of table) {
      if (n < div) {
        unit = name;
        break;
      }
      n = Math.floor(n / div);
      unit = name;
    }
    if (!Number.isFinite(n)) return "";
    return `${n} ${unit}${n === 1 ? "" : "s"} ago`;
  }

  function absoluteTitle(value) {
    const ms = parseTimestamp(value);
    if (ms == null || !Number.isFinite(ms)) return "";
    return new Date(ms).toUTCString();
  }

  OR.time = { parseTimestamp, relativeTime, absoluteTitle };
})(window.OldReddit);
