// In-chat Saad Studio panel for ChatGPT (OpenAI Apps SDK / MCP Apps widget).
//
// One self-contained HTML document (no external scripts) that renders in two modes
// from the tool's structuredContent (`window.openai.toolOutput`):
//   • view === "dashboard"  → the full studio panel: prompt box, image/video toggle,
//     model / aspect / quality pickers, live credit quote, balance, generate,
//     recent creations and one-click workflows.
//   • otherwise a generation result (imageUrls / videoUrls) → a compact result card
//     with download + preview actions.
//
// The panel talks to the same MCP server through `window.openai.callTool(...)`
// (generate_image, generate_video, quote_generation, check_balance,
// show_generations). It is only ever served by the ChatGPT variant of the MCP
// endpoint (see lib/smart-cli-chatgpt.ts); Claude and other agents never see it.
//
// Safety: all dynamic text is inserted with textContent, and URLs are only applied
// when they start with https://.

export const STUDIO_WIDGET_HTML = String.raw`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<style>
  :root {
    --bg: #060c18; --card: #0c111b; --card2: #101827; --line: rgba(255,255,255,0.09);
    --text: #f1f5f9; --muted: #94a3b8; --faint: #64748b;
    --cyan: #22d3ee; --blue: #2563eb; --danger: #f87171; --ok: #34d399;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: transparent; color: var(--text);
    font-family: Inter, system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans Arabic", sans-serif; }
  button, select, textarea { font: inherit; color: inherit; }
  .app { background: radial-gradient(circle at 15% -10%, rgba(34,211,238,0.14), transparent 40%), var(--bg);
    border: 1px solid var(--line); border-radius: 20px; padding: 18px; max-width: 860px; margin: 0 auto; }
  .top { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 14px; }
  .brand { display: flex; align-items: center; gap: 10px; font-weight: 800; letter-spacing: .02em; }
  .brand img { width: 30px; height: 30px; object-fit: contain; }
  .top-actions { display: flex; gap: 8px; align-items: center; }
  .chip { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 12px; border-radius: 999px;
    border: 1px solid var(--line); background: rgba(255,255,255,0.05); color: var(--text); font-size: 12px; font-weight: 700; }
  .chip.accent { border-color: rgba(34,211,238,.3); background: rgba(34,211,238,.1); color: #cffafe; }
  button.chip { cursor: pointer; } button.chip:hover { background: rgba(255,255,255,0.1); }
  h1 { margin: 6px 0 14px; text-align: center; font-size: 22px; line-height: 1.25; font-weight: 800; }
  .composer { background: var(--card2); border: 1px solid var(--line); border-radius: 18px; padding: 12px; }
  textarea { width: 100%; min-height: 76px; resize: vertical; background: transparent; border: 0; outline: 0; font-size: 15px; line-height: 1.55; }
  textarea::placeholder { color: var(--faint); }
  .opts { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 8px; }
  .seg { display: inline-flex; padding: 3px; border-radius: 12px; background: rgba(255,255,255,0.06); border: 1px solid var(--line); }
  .seg button { border: 0; background: transparent; color: var(--muted); padding: 6px 12px; border-radius: 9px; font-size: 13px; font-weight: 700; cursor: pointer; }
  .seg button.on { background: rgba(34,211,238,0.18); color: #cffafe; }
  select { height: 34px; border-radius: 10px; border: 1px solid var(--line); background: rgba(255,255,255,0.05); padding: 0 8px; font-size: 13px; max-width: 190px; }
  select option { background: #0c111b; color: var(--text); }
  .spacer { flex: 1; }
  .go { height: 40px; border: 0; border-radius: 12px; padding: 0 18px; font-weight: 800; font-size: 14px; cursor: pointer; color: #04111a;
    background: linear-gradient(90deg, var(--cyan), #60a5fa); display: inline-flex; align-items: center; gap: 8px; }
  .go:disabled { opacity: .45; cursor: not-allowed; }
  .go .cost { font-weight: 700; opacity: .8; font-size: 12px; }
  .hint { margin: 8px 2px 0; font-size: 12px; color: var(--muted); min-height: 16px; }
  .hint.err { color: var(--danger); }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0 4px; justify-content: center; }
  h2 { margin: 20px 0 10px; font-size: 15px; font-weight: 800; display: flex; align-items: center; justify-content: space-between; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 10px; }
  .tile { position: relative; overflow: hidden; border-radius: 14px; border: 1px solid var(--line); background: var(--card); }
  .tile img, .tile video { display: block; width: 100%; height: auto; max-height: 460px; object-fit: contain; background: #000; }
  .tile .meta { padding: 8px 10px; font-size: 12px; color: var(--muted); line-height: 1.5; }
  .tile .meta b { color: var(--text); font-weight: 700; }
  .tile .acts { display: flex; gap: 6px; padding: 0 10px 10px; flex-wrap: wrap; }
  .tile .dl { position: absolute; top: 8px; right: 8px; width: 34px; height: 34px; border-radius: 999px; border: 1px solid rgba(255,255,255,.18);
    background: rgba(0,0,0,.6); color: #fff; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
  .tile .dl:hover { background: var(--cyan); color: #000; }
  .tile.wide { grid-column: 1 / -1; max-width: 560px; }
  .stack { display: grid; gap: 16px; }
  .result .grid { grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }
  .result .meta { padding-left: 2px; padding-right: 2px; }
  .result .acts { padding: 0 0 4px; }
  .pending { display: flex; align-items: center; gap: 12px; padding: 16px; color: var(--muted); font-size: 13px; }
  .spin { width: 18px; height: 18px; border-radius: 50%; border: 2px solid rgba(255,255,255,.18); border-top-color: var(--cyan); animation: sp .8s linear infinite; flex: none; }
  @keyframes sp { to { transform: rotate(360deg); } }
  .presets { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 10px; }
  .preset { display: flex; flex-direction: column; border-radius: 14px; overflow: hidden; border: 1px solid var(--line); background: var(--card); }
  .preset .thumb { height: 110px; background-size: cover; background-position: center; background-color: #101827; }
  .preset .body { padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 6px; flex: 1; }
  .preset .t { font-weight: 800; font-size: 14px; } .preset .d { font-size: 12px; line-height: 1.5; color: var(--muted); flex: 1; }
  .try { align-self: flex-start; height: 32px; padding: 0 12px; border-radius: 10px; border: 1px solid rgba(34,211,238,.35);
    background: rgba(34,211,238,.1); color: #cffafe; font-weight: 800; font-size: 12px; cursor: pointer; }
  .try:hover { background: rgba(34,211,238,.2); }
  .empty { padding: 18px; text-align: center; color: var(--faint); font-size: 13px; border: 1px dashed var(--line); border-radius: 14px; }
  .note { margin-top: 16px; text-align: center; font-size: 11px; color: var(--faint); }
  .hidden { display: none !important; }
  .rtl { direction: rtl; text-align: right; }
</style>
</head>
<body>
<div class="app" id="app"><div class="empty" id="boot">Loading Saad Studio…</div></div>
<script>
(function () {
  "use strict";
  var LOGO = "https://saadstudio.app/logo-saad-transparent.png?v=3";
  var ORIGIN = "https://saadstudio.app";
  var host = window.openai || null;
  var app = document.getElementById("app");

  var IMAGE_ASPECTS = ["1:1", "16:9", "9:16", "4:3", "3:4"];
  var VIDEO_ASPECTS = ["16:9", "9:16", "1:1"];
  var S = {
    mode: "boot", kind: "image", models: [], defaults: {}, presets: [],
    results: [], recent: [], busy: 0, balance: null, quote: null, quoteSeq: 0,
    prompt: "", error: "", info: "", els: {}
  };

  // ── helpers ────────────────────────────────────────────────────────────
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (!Object.prototype.hasOwnProperty.call(attrs, k) || attrs[k] == null || attrs[k] === false) continue;
      if (k === "text") el.textContent = String(attrs[k]);
      else if (k === "class") el.className = attrs[k];
      else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), attrs[k]);
      else el.setAttribute(k, attrs[k] === true ? "" : String(attrs[k]));
    }
    (kids || []).forEach(function (c) { if (c) el.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return el;
  }
  function safeUrl(u) { return typeof u === "string" && /^https:\/\//i.test(u) ? u : ""; }
  function isArabic(t) { return /[؀-ۿ]/.test(t || ""); }
  var SVG_NS = "http://www.w3.org/2000/svg";
  function downloadIcon() {
    var svg = document.createElementNS(SVG_NS, "svg");
    ["width:16", "height:16", "viewBox:0 0 24 24", "fill:none", "stroke:currentColor", "stroke-width:2.2", "stroke-linecap:round", "stroke-linejoin:round"].forEach(function (a) {
      var i = a.indexOf(":"); svg.setAttribute(a.slice(0, i), a.slice(i + 1));
    });
    ["M12 3v12", "m7 10 5 5 5-5", "M5 21h14"].forEach(function (d) {
      var p = document.createElementNS(SVG_NS, "path"); p.setAttribute("d", d); svg.appendChild(p);
    });
    return svg;
  }
  function iconBtn(cls, title, onclick) {
    return h("button", { class: cls, type: "button", title: title, "aria-label": title, onclick: onclick }, [downloadIcon()]);
  }
  function call(name, args) {
    if (!host || typeof host.callTool !== "function") return Promise.reject(new Error("This panel needs to run inside ChatGPT."));
    return host.callTool(name, args || {}).then(function (res) {
      if (res && res.isError) {
        var t = res.content && res.content[0] && res.content[0].text;
        var msg = "Request failed.";
        try { msg = (JSON.parse(t || "{}").error) || msg; } catch (e) { if (t) msg = t; }
        throw new Error(msg);
      }
      return (res && (res.structuredContent || (res.toolOutput))) || res || {};
    });
  }
  function openLink(href) {
    var u = safeUrl(href); if (!u) return;
    if (host && typeof host.openExternal === "function") host.openExternal({ href: u }); else window.open(u, "_blank", "noopener");
  }
  function follow(prompt) {
    if (host && typeof host.sendFollowUpMessage === "function") host.sendFollowUpMessage({ prompt: prompt });
  }
  function persist() {
    if (!host || typeof host.setWidgetState !== "function") return;
    try { host.setWidgetState({ results: S.results.slice(0, 6), prompt: S.prompt, kind: S.kind }); } catch (e) { /* ignore */ }
  }
  function downloadHref(item, i) {
    return item.previewUrl ? item.previewUrl.replace(/\/$/, "") + "/download?i=" + i : "";
  }
  function modelsOf(kind) { return S.models.filter(function (m) { return m.kind === kind; }); }
  function label(m) { return m.label + (m.badges && m.badges.indexOf("fast") >= 0 ? " ⚡" : ""); }

  // ── result items ───────────────────────────────────────────────────────
  function toItem(out, kindHint) {
    var urls = out.videoUrls && out.videoUrls.length ? out.videoUrls : out.imageUrls && out.imageUrls.length ? out.imageUrls : [];
    if (!urls.length && out.imageUrl) urls = [out.imageUrl];
    if (!urls.length && out.videoUrl) urls = [out.videoUrl];
    var isVideo = !!(out.videoUrls || out.videoUrl) || kindHint === "video";
    return {
      kind: isVideo ? "video" : "image", urls: urls.filter(safeUrl), previewUrl: safeUrl(out.previewUrl),
      prompt: out.prompt || "", model: out.modelLabel || out.modelId || "", aspect: out.aspectRatio || "",
      duration: out.duration || 0, generationId: out.generationId || ""
    };
  }

  function mediaTile(item, i) {
    var url = item.urls[i];
    var media;
    if (item.kind === "video") media = h("video", { src: url, controls: true, playsinline: true, preload: "metadata" });
    else media = h("img", { src: url, alt: item.prompt || "Generated image", loading: "lazy" });
    var tile = h("div", { class: "tile" + (item.urls.length === 1 ? " wide" : "") }, [media]);
    var dl = downloadHref(item, i);
    if (dl) tile.appendChild(iconBtn("dl", "Download", function () { openLink(dl); }));
    media.addEventListener("error", function () {
      var fb = h("div", { class: "empty", text: "Preview unavailable here." }); media.replaceWith(fb);
    });
    return tile;
  }

  function resultCard(item) {
    var wrap = h("div", { class: "result" });
    var meta = [];
    if (item.model) meta.push(item.model);
    if (item.aspect) meta.push(item.aspect);
    if (item.duration) meta.push(item.duration + "s");
    var grid = h("div", { class: "grid" }, item.urls.map(function (_, i) { return mediaTile(item, i); }));
    var cap = h("div", { class: "meta" + (isArabic(item.prompt) ? " rtl" : "") }, [
      h("b", { text: meta.join(" · ") }),
      item.prompt ? h("div", { text: item.prompt.length > 220 ? item.prompt.slice(0, 219) + "…" : item.prompt }) : null
    ]);
    var acts = h("div", { class: "acts" });
    if (item.previewUrl) acts.appendChild(h("button", { class: "chip", type: "button", text: "Open preview", onclick: function () { openLink(item.previewUrl); } }));
    if (item.kind === "image" && item.urls[0]) acts.appendChild(h("button", { class: "chip accent", type: "button", text: "Animate this", onclick: function () {
      follow("Animate the image I just made with Saad Studio into a short video: " + item.urls[0]);
    } }));
    acts.appendChild(h("button", { class: "chip", type: "button", text: "Make variations", onclick: function () {
      follow("Make 3 variations of this with Saad Studio: " + (item.prompt || "same idea"));
    } }));
    wrap.appendChild(grid); wrap.appendChild(cap); wrap.appendChild(acts);
    return wrap;
  }

  // ── dashboard ──────────────────────────────────────────────────────────
  function fillSelect(sel, values, current, fmt) {
    sel.replaceChildren();
    values.forEach(function (v) {
      var o = document.createElement("option"); o.value = v.value != null ? v.value : v; o.textContent = v.text != null ? v.text : (fmt ? fmt(v) : v);
      sel.appendChild(o);
    });
    if (current != null) sel.value = current;
    if (sel.value !== String(current) && sel.options.length) sel.selectedIndex = 0;
  }

  function refreshControls() {
    var E = S.els, kind = S.kind;
    E.segImage.className = kind === "image" ? "on" : ""; E.segVideo.className = kind === "video" ? "on" : "";
    var ms = modelsOf(kind), def = kind === "image" ? S.defaults.image : S.defaults.video;
    var keep = E.model.value && ms.some(function (m) { return m.id === E.model.value; }) ? E.model.value : def;
    fillSelect(E.model, ms.map(function (m) { return { value: m.id, text: label(m) }; }), keep);
    var keepAspect = E.aspect.value;
    var aspects = kind === "image" ? IMAGE_ASPECTS : VIDEO_ASPECTS;
    fillSelect(E.aspect, aspects, aspects.indexOf(keepAspect) >= 0 ? keepAspect : (kind === "image" ? "1:1" : "16:9"));
    if (kind === "image") {
      fillSelect(E.opt1, [{ value: "1K", text: "1K" }, { value: "2K", text: "2K" }], E.opt1.value === "2K" ? "2K" : "1K");
      fillSelect(E.opt2, [1, 2, 3, 4].map(function (n) { return { value: String(n), text: n + (n === 1 ? " image" : " images") }; }), E.opt2.value || "1");
    } else {
      fillSelect(E.opt1, [{ value: "5", text: "5s" }, { value: "10", text: "10s" }], E.opt1.value === "10" ? "10" : "5");
      fillSelect(E.opt2, [{ value: "720p", text: "720p" }, { value: "1080p", text: "1080p" }], E.opt2.value === "720p" ? "720p" : "1080p");
    }
    requestQuote();
  }

  function currentArgs() {
    var E = S.els;
    if (S.kind === "image") return { modelId: E.model.value, aspectRatio: E.aspect.value, resolution: E.opt1.value, numImages: Number(E.opt2.value) || 1 };
    return { modelId: E.model.value, aspectRatio: E.aspect.value, duration: Number(E.opt1.value) || 5, resolution: E.opt2.value };
  }

  var quoteTimer = null;
  function requestQuote() {
    clearTimeout(quoteTimer);
    quoteTimer = setTimeout(function () {
      var seq = ++S.quoteSeq, a = currentArgs();
      var q = { kind: S.kind, modelId: a.modelId, aspectRatio: a.aspectRatio, resolution: a.resolution };
      if (S.kind === "image") q.numImages = a.numImages; else q.duration = a.duration;
      call("quote_generation", q).then(function (r) {
        if (seq !== S.quoteSeq) return;
        S.quote = typeof r.credits === "number" ? r : null;
        if (typeof r.creditBalance === "number") S.balance = r.creditBalance;
        refreshCost();
      }).catch(function () { if (seq === S.quoteSeq) { S.quote = null; refreshCost(); } });
    }, 350);
  }

  function refreshCost() {
    var E = S.els;
    E.cost.textContent = S.quote ? "· " + S.quote.credits + " credits" : "";
    E.balance.textContent = S.balance == null ? "Credits" : Math.round(S.balance * 100) / 100 + " credits";
    E.go.disabled = S.busy > 0 || !E.prompt.value.trim();
  }

  function setHint(msg, isErr) { S.els.hint.textContent = msg || ""; S.els.hint.className = "hint" + (isErr ? " err" : ""); }

  function generate() {
    var E = S.els, prompt = E.prompt.value.trim();
    if (!prompt || S.busy) return;
    var kind = S.kind, args = currentArgs(); args.prompt = prompt;
    S.busy++; E.go.disabled = true; setHint("");
    var pend = h("div", { class: "tile wide" }, [h("div", { class: "pending" }, [h("div", { class: "spin" }),
      h("div", { text: kind === "video" ? "Rendering your video — this can take a few minutes. You can keep chatting." : "Creating your image…" })])]);
    E.results.classList.remove("hidden"); E.resultGrid.insertBefore(pend, E.resultGrid.firstChild);
    call(kind === "video" ? "generate_video" : "generate_image", args).then(function (out) {
      var item = toItem(out, kind);
      pend.remove();
      if (!item.urls.length) { setHint("Your video is still processing. Check Recent creations in a moment.", false); return; }
      S.results.unshift(item); E.resultGrid.insertBefore(resultCard(item), E.resultGrid.firstChild);
      persist(); loadBalance(); loadRecent();
    }).catch(function (e) {
      pend.remove(); setHint(e && e.message ? e.message : "Generation failed.", true);
    }).then(function () { S.busy--; refreshCost(); });
  }

  function loadBalance() {
    call("check_balance").then(function (r) { if (typeof r.creditBalance === "number") { S.balance = r.creditBalance; refreshCost(); } }).catch(function () {});
  }

  function loadRecent() {
    call("show_generations", { limit: 8 }).then(function (r) {
      var items = (r && r.items) || [];
      S.recent = items.filter(function (x) { return x && safeUrl(x.url) && (x.kind === "image" || x.kind === "video"); }).slice(0, 8);
      renderRecent();
    }).catch(function () { renderRecent(); });
  }

  function renderRecent() {
    var box = S.els.recent; box.replaceChildren();
    if (!S.recent.length) { box.appendChild(h("div", { class: "empty", text: "Your latest creations will appear here." })); return; }
    S.recent.forEach(function (x) {
      var m = x.kind === "video" ? h("video", { src: x.url, muted: true, preload: "metadata", playsinline: true, controls: true }) : h("img", { src: x.url, alt: x.prompt || "Creation", loading: "lazy" });
      var cap = x.kind === "image" ? h("div", { class: "acts" }, [h("button", { class: "chip", type: "button", text: "Animate", onclick: function () {
        follow("Animate this Saad Studio image into a 5-second video: " + x.url); } })]) : null;
      m.addEventListener("error", function () { m.replaceWith(h("div", { class: "empty", text: "Unavailable" })); });
      box.appendChild(h("div", { class: "tile" }, [m, cap]));
    });
  }

  function thumbStyle(p) { return p && typeof p.thumb === "string" && /^\/images\/chatgpt-panel\/[\w.-]+$/.test(p.thumb) ? "background-image:url('" + ORIGIN + p.thumb + "')" : ""; }

  function buildDashboard(out) {
    app.replaceChildren();
    var E = S.els = {};
    E.balance = h("span", { class: "chip accent", text: "Credits" });
    var expand = h("button", { class: "chip", type: "button", text: "Expand", onclick: function () {
      if (host && host.requestDisplayMode) host.requestDisplayMode({ mode: "fullscreen" }); } });
    app.appendChild(h("div", { class: "top" }, [
      h("div", { class: "brand" }, [h("img", { src: LOGO, alt: "" }), h("span", { text: "Saad Studio" })]),
      h("div", { class: "top-actions" }, [E.balance, expand])
    ]));
    app.appendChild(h("h1", { text: "What would you like to create?" }));

    E.prompt = h("textarea", { placeholder: "Describe what you want to create…  (Arabic works too)", rows: "3" });
    E.prompt.value = S.prompt;
    E.prompt.addEventListener("input", function () { S.prompt = E.prompt.value; E.prompt.className = isArabic(S.prompt) ? "rtl" : ""; refreshCost(); persist(); });
    E.prompt.addEventListener("keydown", function (ev) { if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) generate(); });
    E.segImage = h("button", { type: "button", text: "Image", onclick: function () { S.kind = "image"; refreshControls(); persist(); } });
    E.segVideo = h("button", { type: "button", text: "Video", onclick: function () { S.kind = "video"; refreshControls(); persist(); } });
    E.model = h("select", { "aria-label": "Model" }); E.aspect = h("select", { "aria-label": "Aspect ratio" });
    E.opt1 = h("select", { "aria-label": "Quality or duration" }); E.opt2 = h("select", { "aria-label": "Count or resolution" });
    [E.model, E.aspect, E.opt1, E.opt2].forEach(function (s) { s.addEventListener("change", requestQuote); });
    E.cost = h("span", { class: "cost" });
    E.go = h("button", { class: "go", type: "button", onclick: generate }, ["Generate", E.cost]);
    E.hint = h("div", { class: "hint" });
    app.appendChild(h("div", { class: "composer" }, [
      E.prompt,
      h("div", { class: "opts" }, [h("div", { class: "seg" }, [E.segImage, E.segVideo]), E.model, E.aspect, E.opt1, E.opt2, h("div", { class: "spacer" }), E.go]),
      E.hint
    ]));

    app.appendChild(h("div", { class: "chips" }, [
      h("button", { class: "chip", type: "button", text: "What can I do with Saad Studio?", onclick: function () {
        follow("What can I do with Saad Studio? Give me a short overview of image, video, audio and post-production."); } }),
      h("button", { class: "chip", type: "button", text: "Create music", onclick: function () { follow("Use Saad Studio to create a short instrumental music track for me."); } }),
      h("button", { class: "chip", type: "button", text: "Text to speech", onclick: function () { follow("Use Saad Studio to turn a text I give you into speech."); } }),
      h("button", { class: "chip", type: "button", text: "Open full studio", onclick: function () { openLink(ORIGIN + "/explore"); } })
    ]));

    E.resultGrid = h("div", { class: "stack" });
    E.results = h("div", { class: S.results.length ? "" : "hidden" }, [h("h2", { text: "Your results" }), E.resultGrid]);
    S.results.forEach(function (it) { E.resultGrid.appendChild(resultCard(it)); });
    app.appendChild(E.results);

    E.recent = h("div", { class: "grid" });
    app.appendChild(h("h2", { text: "Recent creations" })); app.appendChild(E.recent);

    app.appendChild(h("h2", { text: "Start from a workflow" }));
    app.appendChild(h("div", { class: "presets" }, S.presets.map(function (p) {
      return h("div", { class: "preset" }, [
        h("div", { class: "thumb", style: thumbStyle(p) }),
        h("div", { class: "body" }, [h("div", { class: "t", text: p.title }), h("div", { class: "d", text: p.description }),
          h("button", { class: "try", type: "button", text: "Try this workflow", onclick: function () { follow(p.prompt); } })])
      ]);
    })));
    app.appendChild(h("div", { class: "note", text: "Generations use your Saad Studio credits · saadstudio.app" }));

    if (out && out.prefill) {
      if (out.prefill.kind === "video") S.kind = "video";
      if (out.prefill.prompt) { E.prompt.value = out.prefill.prompt; S.prompt = out.prefill.prompt; }
    }
    refreshControls(); refreshCost(); loadBalance(); loadRecent();
  }

  // ── result-only mode (a normal generate_* call made by the model) ─────
  function buildResult(out) {
    app.replaceChildren();
    var item = toItem(out);
    app.appendChild(h("div", { class: "top" }, [
      h("div", { class: "brand" }, [h("img", { src: LOGO, alt: "" }), h("span", { text: "Saad Studio" })]),
      h("div", { class: "top-actions" }, [h("button", { class: "chip", type: "button", text: "Open studio", onclick: function () { follow("Open the Saad Studio panel."); } })])
    ]));
    if (!item.urls.length) { app.appendChild(h("div", { class: "empty", text: "No media returned yet. Ask me to check the job status in a moment." })); return; }
    app.appendChild(resultCard(item));
    if (host && host.notifyIntrinsicHeight) try { host.notifyIntrinsicHeight(); } catch (e) { /* ignore */ }
  }

  // ── entry ──────────────────────────────────────────────────────────────
  function applyOutput(out) {
    if (!out || typeof out !== "object") return;
    if (out.view === "dashboard") {
      S.mode = "dashboard"; S.models = out.models || []; S.defaults = out.defaults || {}; S.presets = out.presets || [];
      var saved = host && host.widgetState;
      if (saved && typeof saved === "object") { S.results = Array.isArray(saved.results) ? saved.results : []; S.prompt = saved.prompt || ""; S.kind = saved.kind || "image"; }
      buildDashboard(out);
    } else if (out.imageUrls || out.videoUrls || out.imageUrl || out.videoUrl) {
      S.mode = "result"; buildResult(out);
    }
  }

  var first = host && (host.toolOutput || (host.toolResponseMetadata && host.toolResponseMetadata.structuredContent));
  if (first) applyOutput(first);
  else if (!host) app.replaceChildren(h("div", { class: "empty", text: "Open this panel inside ChatGPT to create with Saad Studio." }));
  window.addEventListener("openai:set_globals", function (ev) {
    var g = ev && ev.detail && ev.detail.globals;
    if (g && g.toolOutput && S.mode === "boot") applyOutput(g.toolOutput);
  });
  window.__studioDebug = { state: S, applyOutput: applyOutput };
})();
</script>
</body>
</html>`;
