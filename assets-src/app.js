/*
 * assets-src/app.js — the console's ONE script (ADR-0234 §4: behaviour that needs script lives in one served
 * app.js that binds by data- attributes). Plain ES2020, no modules, no build step. It runs under a strict CSP:
 * nodes are built with createElement/textContent/replaceChildren only, never from markup strings.
 * Loaded `defer` right after htmx: the DOM is parsed, htmx has not yet processed the body.
 */
(function () {
  "use strict";

  var doc = document;
  var each = function (root, sel, fn) { Array.prototype.forEach.call((root || doc).querySelectorAll(sel) || [], fn); };
  var isGet = function (verb) { return String(verb || "").toLowerCase() === "get"; };

  // ── 1. weave-json (ADR-0234 §4): every /ui action is sent as the typed JSON body weave's handlers expect ──
  var FORBIDDEN = ["__proto__", "constructor", "prototype"];
  var TYPE_RE = /:(bool|num|str\[\]|num\[\])$/;
  var PATH_RE = /^([^[\]]+)((?:\[[^\]]*\])*)$/;
  var getElts = new WeakSet();

  function typed(type, v) {
    if (type === "bool") return v === "true";
    if (type === "num" || type === "num[]") {
      var n = v.trim() === "" ? NaN : Number(v);
      return Number.isFinite(n) ? n : undefined;
    }
    return v;
  }

  function encode(entries) {
    var root = {};
    var body;
    var hasBody = false;
    entries.forEach(function (kv) {
      var name = kv[0];
      var v = typeof kv[1] === "string" ? kv[1] : "";
      var tm = TYPE_RE.exec(name);
      var type = tm ? tm[1] : "str";
      var path = tm ? name.slice(0, -tm[0].length) : name;
      var val = typed(type, v);
      if (path === "@") {
        if (val !== undefined) { body = val; hasBody = true; }
        return;
      }
      var pm = PATH_RE.exec(path);
      if (!pm) return;
      var segs = [pm[1]].concat(pm[2] ? pm[2].slice(1, -1).split("][") : []);
      if (segs.some(function (s) { return FORBIDDEN.indexOf(s) !== -1; })) return;
      var cur = root;
      for (var i = 0; i < segs.length - 1; i++) {
        var next = Object.prototype.hasOwnProperty.call(cur, segs[i]) ? cur[segs[i]] : undefined;
        if (!next || typeof next !== "object" || Array.isArray(next)) { next = {}; cur[segs[i]] = next; }
        cur = next;
      }
      var last = segs[segs.length - 1];
      if (type === "str[]" || type === "num[]") {
        if (!Array.isArray(cur[last]) || !Object.prototype.hasOwnProperty.call(cur, last)) cur[last] = [];
        if (val !== undefined) cur[last].push(val);
      } else if (val !== undefined) {
        cur[last] = val;
      } else if (Object.prototype.hasOwnProperty.call(cur, last)) {
        delete cur[last];
      }
    });
    return hasBody ? body : root;
  }

  htmx.defineExtension("weave-json", {
    onEvent: function (name, evt) {
      if (name !== "htmx:configRequest") return;
      var d = evt.detail;
      if (isGet(d.verb)) { if (d.elt) getElts.add(d.elt); return; }
      if (d.elt) getElts.delete(d.elt);
      d.headers["Content-Type"] = "application/json";
    },
    encodeParameters: function (xhr, parameters, elt) {
      if (elt && typeof elt === "object" && getElts.has(elt)) return null;
      var entries = [];
      if (parameters && typeof parameters.forEach === "function") parameters.forEach(function (v, k) { entries.push([k, v]); });
      if (!entries.length) return null;
      xhr.overrideMimeType("text/json");
      return JSON.stringify(encode(entries));
    },
  });

  // ── 2. Confirmations: data-confirm, never hx-confirm (an hx-* value may not carry data) ──
  htmx.on("htmx:confirm", function (evt) {
    var t = evt.target;
    var el = t && t.closest ? t.closest("[data-confirm]") : null;
    if (!el) return;
    evt.preventDefault();
    if (window.confirm(el.getAttribute("data-confirm"))) evt.detail.issueRequest(true);
  });

  // ── 3. Hold a view's poll while the operator is typing in it (weave page behaviour) ──
  doc.addEventListener("input", function (e) {
    var form = e.target && e.target.closest ? e.target.closest("form") : null;
    if (form) form.setAttribute("data-dirty", "1");
  });

  htmx.on("htmx:beforeRequest", function (evt) {
    var d = evt.detail;
    var elt = d.elt;
    if (!elt || !isGet(d.requestConfig && d.requestConfig.verb) || !/^view-/.test(elt.id || "")) return;
    var a = doc.activeElement;
    var typing = a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && elt.contains(a);
    if (typing || elt.querySelector("form[data-dirty]")) evt.preventDefault();
  });

  // ── 4. Keep <details data-keep> open state and [data-keep-scroll] positions across swaps ──
  var kept = {};

  function markDefaults(root) {
    each(root, "details[data-keep][open]", function (d) { d.setAttribute("data-default-open", "1"); });
  }

  function remember(target) {
    if (!target || !target.id) return;
    var s = { open: [], closed: [], scroll: {} };
    each(target, "details[data-keep]", function (d) {
      var k = d.getAttribute("data-keep");
      if (d.open) s.open.push(k);
      else if (d.hasAttribute("data-default-open")) s.closed.push(k);
    });
    each(target, "[data-keep-scroll][id]", function (el) {
      s.scroll[el.id] = el.scrollHeight - el.scrollTop - el.clientHeight < 60 ? "bottom" : el.scrollTop;
    });
    kept[target.id] = s;
  }

  // restore(id) applies only that target's kept state; restore() applies every pending entry.
  function restore(only) {
    (only ? [only] : Object.keys(kept)).forEach(function (id) {
      if (!Object.prototype.hasOwnProperty.call(kept, id)) return;
      var el = doc.getElementById(id);
      var s = kept[id];
      delete kept[id];
      if (!el) return;
      markDefaults(el);
      each(el, "details[data-keep]", function (d) {
        var k = d.getAttribute("data-keep");
        if (s.open.indexOf(k) !== -1) d.open = true;
        else if (s.closed.indexOf(k) !== -1) d.open = false;
      });
      Object.keys(s.scroll).forEach(function (sid) {
        var sc = doc.getElementById(sid);
        if (sc) sc.scrollTop = s.scroll[sid] === "bottom" ? sc.scrollHeight : s.scroll[sid];
      });
    });
  }

  htmx.on("htmx:oobBeforeSwap", function (evt) { remember(evt.detail.target); });
  htmx.on("htmx:beforeSwap", function (evt) { remember(evt.detail.target); });
  // htmx 2 runs the OOB swaps before the main swap: an OOB swap restores only its own target, so the main
  // target's entry survives until afterSettle, when its new content is in the DOM.
  htmx.on("htmx:oobAfterSwap", function (evt) {
    var t = evt.detail.target;
    if (t && t.id) restore(t.id);
  });

  // ── 5. Times: <time data-ts data-fmt> rendered in the operator's locale and kept fresh ──
  function span(ms) {
    var s = Math.round(Math.abs(ms) / 1000);
    if (s < 90) return s + "s";
    var m = Math.round(s / 60);
    if (m < 90) return m + "m";
    var h = Math.round(m / 60);
    if (h < 36) return h + "h";
    var d = Math.round(h / 24);
    return d < 7 ? d + "d" : null;
  }

  function ago(ts, now) {
    var diff = now - ts;
    if (Math.abs(diff) < 10000) return "just now";
    var s = span(diff);
    if (!s) return new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short" });
    return diff < 0 ? "in " + s : s + " ago";
  }

  function renderTimes(root) {
    var now = Date.now();
    each(root, "time[data-ts]", function (t) {
      var ts = Number(t.getAttribute("data-ts"));
      if (!Number.isFinite(ts)) return;
      var date = new Date(ts);
      var fmt = t.getAttribute("data-fmt") || "ago";
      var text;
      if (fmt === "local") text = date.toLocaleString();
      else if (fmt === "time") text = date.toLocaleTimeString();
      else if (fmt === "dur") {
        var to = Number(t.getAttribute("data-to"));
        var ms = Number.isFinite(to) ? to - ts : now - ts;
        text = span(ms) || Math.round(Math.abs(ms) / 86400000) + "d";
      } else {
        text = ago(ts, now);
        if (fmt === "until") {
          var left = ts - now;
          if (left <= 0) t.setAttribute("data-tone", "bad");
          else if (left <= 120000) t.setAttribute("data-tone", "needs");
          else t.removeAttribute("data-tone");
        }
      }
      if (t.textContent !== text) t.textContent = text;
      t.setAttribute("title", date.toLocaleString());
    });
  }

  doc.addEventListener("DOMContentLoaded", function () { renderTimes(doc); });
  setInterval(function () { renderTimes(doc); }, 30000);

  // ── 6. Nav badges and the title badge, from counts the views carry ──
  function setBadge(navKey, n) {
    each(doc, "#nav a[data-key]", function (a) {
      if (a.getAttribute("data-key") !== navKey) return;
      var badges = a.querySelectorAll("span.badge");
      for (var i = 1; i < badges.length; i++) badges[i].remove();
      var b = badges[0];
      if (!(n > 0)) { if (b) b.remove(); return; }
      if (!b) { b = doc.createElement("span"); b.className = "badge"; a.appendChild(b); }
      b.setAttribute("data-tone", "needs");
      b.setAttribute("aria-label", n + " need you");
      b.textContent = String(n);
    });
  }

  function updateCounts() {
    each(doc, "[data-nav-count]", function (el) {
      var v = el.getAttribute("data-nav-count");
      var i = v.lastIndexOf(":");
      if (i > 0) setBadge(v.slice(0, i), Number(v.slice(i + 1)) || 0);
    });
    var needs = doc.querySelector("[data-needs-count]");
    if (needs) {
      var n = Number(needs.getAttribute("data-needs-count")) || 0;
      var base = doc.title.replace(/^\(\d+\) /, "");
      doc.title = n > 0 ? "(" + n + ") " + base : base;
    }
  }

  // ── 7. Clear a stale #weave-error once a later request succeeds ──
  // htmx:oobAfterSwap carries no xhr; its response is the one whose htmx:beforeSwap ran just before.
  // "Later" is by send order: a request sent before the error's request does not clear it, however late it ends.
  var sent = 0, sentSeq = new WeakMap(), errorSeq = 0, swapXhr = null;
  function seqOf(xhr) { var n = xhr && sentSeq.get(xhr); return n === undefined ? sent : n; }
  htmx.on("htmx:beforeRequest", function (evt) { if (evt.detail.xhr) sentSeq.set(evt.detail.xhr, ++sent); });
  htmx.on("htmx:beforeSwap", function (evt) { swapXhr = evt.detail.xhr; });
  htmx.on("htmx:oobAfterSwap", function (evt) {
    if (evt.detail.target && evt.detail.target.id === "weave-error") errorSeq = seqOf(swapXhr);
  });
  htmx.on("htmx:afterSwap", function (evt) {
    if (evt.detail.target && evt.detail.target.id === "weave-error") errorSeq = seqOf(evt.detail.xhr);
  });
  // htmx:beforeSwap on an error status: nothing to do — responseHandling already swaps 4xx/5xx.

  // ── 9c / 10 state, shared with afterRequest ──
  var picks = new WeakMap();
  var auditSha = null, auditXhr = null;

  htmx.on("htmx:afterRequest", function (evt) {
    var d = evt.detail;
    var elt = d.elt;
    if (!d.successful) return;
    if (elt && elt.tagName === "FORM") elt.removeAttribute("data-dirty");
    var err = doc.getElementById("weave-error");
    if (err && !err.hidden && d.xhr && sentSeq.get(d.xhr) > errorSeq) { err.replaceChildren(); err.hidden = true; }
    var pick = elt && picks.get(elt);
    if (pick) history.replaceState(history.state, "", "?" + encodeURIComponent(pick[0]) + "=" + encodeURIComponent(pick[1]));
  });

  // ── 8. Enter sends: <textarea data-enter-submits> ──
  doc.addEventListener("keydown", function (e) {
    var t = e.target;
    if (e.key !== "Enter" || !t || t.tagName !== "TEXTAREA" || !t.hasAttribute("data-enter-submits")) return;
    if (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey || e.isComposing || e.keyCode === 229) return;
    if (!t.form) return;
    e.preventDefault();
    t.form.requestSubmit();
  });

  // ── 9. Phase 2 page shells (body[data-shell]) ──
  var SHELLS = { "/": "home", "/work": "work", "/control": "control", "/factory": "factory", "/machines": "machines",
    "/peers": "machines", "/team": "team", "/task": "task", "/audit": "audit" };
  var shell = doc.body && doc.body.getAttribute("data-shell") != null;

  function rewriteLinks(root) {
    each(root, "a[href]", function (a) {
      if (a.origin !== location.origin) return;
      var key = SHELLS[a.pathname];
      if (key) a.setAttribute("href", "/ui/assets/pages/" + key + ".html" + a.search + a.hash);
    });
  }

  if (shell) {
    // (a) carry the page's query into the views that need it, before htmx processes the body
    each(doc, "[data-query-from-location]", function (el) {
      var search = location.search;
      if (search) {
        var get = el.getAttribute("hx-get") || "";
        el.setAttribute("hx-get", get + (get.indexOf("?") === -1 ? "?" : "&") + search.slice(1));
      } else if (el.hasAttribute("data-query-required")) {
        el.removeAttribute("hx-get");
        el.removeAttribute("hx-trigger");
      }
    });
    // (b) the shells link to each other
    rewriteLinks(doc);
  }

  htmx.on("htmx:configRequest", function (evt) {
    // (c) form[data-query-pick]: kind + value become one ?<kind>=<value> parameter
    var elt = evt.detail.elt;
    if (!elt || !elt.hasAttribute || !elt.hasAttribute("data-query-pick")) return;
    var p = evt.detail.parameters;
    var kind = String(p.get("kind") || "");
    var value = String(p.get("value") || "").trim();
    p.delete("kind");
    p.delete("value");
    if (!value || ["id", "thread", "since", "find"].indexOf(kind) === -1) { evt.preventDefault(); return; }
    p.set(kind, value);
    picks.set(elt, [kind, value]);
  });

  htmx.on("htmx:load", function (evt) {
    var el = evt.detail.elt;
    renderTimes(el);
    markDefaults(el);
    if (shell) rewriteLinks(el);
  });

  // ── 10. Audit check: does the log still give exactly this record? ──
  htmx.on("htmx:beforeRequest", function (evt) {
    var elt = evt.detail.elt;
    if (!elt || !elt.hasAttribute || !elt.hasAttribute("data-audit-check")) return;
    var cur = doc.querySelector("#view-audit [data-audit-sha]");
    auditSha = cur ? cur.getAttribute("data-audit-sha") : "";
    auditXhr = evt.detail.xhr;
  });

  // Only the audit request's own settle finishes the check; other swaps (polls, counts) settle too.
  function auditResult(xhr) {
    if (auditSha === null || !xhr || xhr !== auditXhr) return;
    var was = auditSha;
    auditSha = null;
    auditXhr = null;
    if (!(xhr.status >= 200 && xhr.status < 300)) return;
    var now = doc.querySelector("#view-audit [data-audit-sha]");
    var out = doc.querySelector("#view-audit [data-audit-result]");
    if (!now || !out) return;
    var same = now.getAttribute("data-audit-sha") === was;
    out.textContent = same ? "The log still gives exactly this record."
      : "The log gives a different record now — new events landed in this selection. Show it again to see them.";
    out.setAttribute("data-tone", same ? "ok" : "bad");
  }

  // After any swap settles: restore kept state, refresh counts, finish an audit check.
  htmx.on("htmx:afterSettle", function (evt) {
    restore();
    updateCounts();
    auditResult(evt.detail && evt.detail.xhr);
  });
})();
