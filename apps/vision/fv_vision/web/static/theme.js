// Applied before the stylesheet paints, so a saved theme does not flash.
try { const t = localStorage.getItem("fvv-theme"); if (t) document.documentElement.dataset.theme = t; } catch (e) { /* private mode */ }
