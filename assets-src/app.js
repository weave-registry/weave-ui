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
  var TYPE_RE = /:(bool|num|str\[\]|num\[\]|csv\[\])$/;
  var FILE_RE = /^(?:[A-Za-z0-9_-][A-Za-z0-9._-]*|skills\/[a-z0-9-]+\/SKILL\.md)$/;
  var PATH_RE = /^([^[\]]+)((?:\[[^\]]*\])*)$/;
  var getElts = new WeakSet();

  function typed(type, v) {
    if (type === "bool") return v === "true";
    if (type === "num" || type === "num[]") {
      var n = v.trim() === "" ? NaN : Number(v);
      return Number.isFinite(n) ? n : undefined;
    }
    if (type === "csv[]") return v.split(",").map(function (p) { return p.trim(); }).filter(Boolean);
    return v;
  }

  // The object at root.define.files, created as needed (the role editor's add/remove-a-file fields act on it).
  function filesOf(root) {
    var cur = root;
    ["define", "files"].forEach(function (k) {
      var next = Object.prototype.hasOwnProperty.call(cur, k) ? cur[k] : undefined;
      if (!next || typeof next !== "object" || Array.isArray(next)) { next = {}; cur[k] = next; }
      cur = next;
    });
    return cur;
  }

  function fileOk(path) { return FILE_RE.test(path) && FORBIDDEN.indexOf(path) === -1; }

  // Why the role editor's add-a-file fields can't be sent as they are ("" when they can): encode drops a file whose
  // path is empty or not allowed, or one the editor already shows, so typed text would be thrown away with no word to
  // the operator (or, for the last, would have to overwrite that file's text).
  function newFileProblem(path, body, params) {
    if (!path && !body) return "";
    if (!path) return "Give the new file a path, or clear its text.";
    if (!fileOk(path)) return "A file path is one name of letters, digits, '.', '-' or '_' (no spaces or folders), or skills/<name>/SKILL.md with a lowercase <name>.";
    if (hasParam(params, "define[files][" + path + "]")) return "This role already has a file named " + path + ". Edit it above, or give the new file another path.";
    return "";
  }
  // The first :num field whose text isn't a number ([name, message], or null): encode would leave it out of the body,
  // so the save would succeed and the swap would throw away what the operator typed.
  function numProblem(params) {
    var found = null;
    var check = function (v, k) {
      if (found || !/:num(?:\[\])?$/.test(k) || typeof v !== "string" || v.trim() === "") return;
      if (typed("num", v) === undefined) found = [k, "Enter a plain number, like 25 or 7.5: no $ sign or thousands commas, and a dot for decimals."];
    };
    if (params && typeof params.forEach === "function") params.forEach(check);
    else if (params) Object.keys(params).forEach(function (k) { check(params[k], k); });
    return found;
  }
  function param(params, k) {
    var v = params && (typeof params.get === "function" ? params.get(k) : params[k]);
    return typeof v === "string" ? v : "";
  }
  function hasParam(params, k) {
    if (!params) return false;
    return typeof params.has === "function" ? params.has(k) : Object.prototype.hasOwnProperty.call(params, k);
  }

  function encode(entries) {
    var root = {};
    var body;
    var hasBody = false;
    var newPath = "", newBody = "", removes = [];
    entries.forEach(function (kv) {
      var name = kv[0];
      var v = typeof kv[1] === "string" ? kv[1] : "";
      if (name === "@new-file:path") { newPath = v; return; }
      if (name === "@new-file:body") { newBody = v; return; }
      if (name === "@remove-file") { removes.push(v); return; }
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
      if (type === "csv[]") {
        cur[last] = val;
      } else if (type === "str[]" || type === "num[]") {
        if (!Array.isArray(cur[last]) || !Object.prototype.hasOwnProperty.call(cur, last)) cur[last] = [];
        if (val !== undefined) cur[last].push(val);
      } else if (val !== undefined) {
        cur[last] = val;
      } else if (Object.prototype.hasOwnProperty.call(cur, last)) {
        delete cur[last];
      }
    });
    if (newPath && fileOk(newPath)) {
      var into = filesOf(root);
      if (!Object.prototype.hasOwnProperty.call(into, newPath)) into[newPath] = newBody;
    }
    if (removes.length) {
      var files = filesOf(root);
      removes.forEach(function (f) { if (Object.prototype.hasOwnProperty.call(files, f)) delete files[f]; });
    }
    return hasBody ? body : root;
  }

  // The value of the cookie named exactly `name`, or "" (absent, empty, or not valid percent-encoding).
  function cookie(name) {
    var parts = String(doc.cookie || "").split(";");
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i].trim();
      var eq = part.indexOf("=");
      if (eq === -1 || part.slice(0, eq) !== name) continue;
      try { return decodeURIComponent(part.slice(eq + 1)); } catch (e) { return ""; }
    }
    return "";
  }

  htmx.defineExtension("weave-json", {
    onEvent: function (name, evt) {
      if (name !== "htmx:configRequest") return;
      var d = evt.detail;
      if (isGet(d.verb)) { if (d.elt) getElts.add(d.elt); return; }
      if (d.elt) getElts.delete(d.elt);
      var bad = newFileProblem(param(d.parameters, "@new-file:path"), param(d.parameters, "@new-file:body"), d.parameters);
      if (bad) {
        evt.preventDefault();
        var input = d.elt && d.elt.querySelector ? d.elt.querySelector('[name="@new-file:path"]') : null;
        if (input && input.setCustomValidity) { input.setCustomValidity(bad); input.reportValidity(); } else window.alert(bad);
        return false;
      }
      var num = numProblem(d.parameters);
      if (num) {
        evt.preventDefault();
        var field = d.elt && d.elt.querySelector ? d.elt.querySelector('[name="' + num[0].replace(/["\\]/g, "\\$&") + '"]') : null;
        if (field && field.setCustomValidity) { field.setCustomValidity(num[1]); field.reportValidity(); } else window.alert(num[1]);
        return false;
      }
      d.headers["Content-Type"] = "application/json";
      // ADR-0245 §5: weave-ui's own server checks a double-submit CSRF token on every non-GET; GETs never carry it
      var csrf = cookie("wui_csrf");
      if (csrf) d.headers["X-CSRF-Token"] = csrf;
    },
    encodeParameters: function (xhr, parameters, elt) {
      if (elt && typeof elt === "object" && getElts.has(elt)) return null;
      var entries = [];
      if (parameters && typeof parameters.forEach === "function") parameters.forEach(function (v, k) { entries.push([k, v]); });
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

  // ── 3. Dirty forms (weave page behaviour) ──
  // edits counts input per form; sentEdits ties each submit to the count it sent, so a reply clears only what it carried.
  // A view's poll is still held while one of its forms carries an unsent draft (the poll tests pin this); typing alone
  // (focus) no longer holds it — §3b carries the operator's work into every fresh fragment instead.
  var edits = new WeakMap(), sentEdits = new WeakMap(), reqForm = new WeakMap();
  // A dirty form whose draft §3b carried into a fresh fragment points at that fresh form, so a request sent from the
  // old element still answers for (and cleans) the form now on the page.
  var moved = new WeakMap();
  function current(form) { var next; while (form && (next = moved.get(form))) form = next; return form; }
  doc.addEventListener("input", function (e) {
    var form = e.target && e.target.closest ? e.target.closest("form") : null;
    if (!form) return;
    if (/^@new-file:/.test(e.target.name || "")) each(form, '[name="@new-file:path"]', function (i) { if (i.setCustomValidity) i.setCustomValidity(""); });
    if (/:num(?:\[\])?$/.test(e.target.name || "") && e.target.setCustomValidity) e.target.setCustomValidity("");
    edits.set(form, (edits.get(form) || 0) + 1);
    if (changed(form)) form.setAttribute("data-dirty", "1");
    else form.removeAttribute("data-dirty"); // emptied back to how it loaded: nothing left to lose, so the poll may run
  });

  // Whether any field differs from the value it loaded with; a form whose fields can't be read counts as changed
  function changed(form) {
    var els = form.elements;
    if (!els || typeof els.length !== "number") return true;
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.type === "checkbox" || el.type === "radio") { if (el.checked !== el.defaultChecked) return true; }
      else if (el.options) { for (var j = 0; j < el.options.length; j++) if (el.options[j].selected !== el.options[j].defaultSelected) return true; }
      else if ("defaultValue" in el && el.value !== el.defaultValue) return true;
    }
    return false;
  }

  var isView = function (el) { return !!el && /^view-/.test(el.id || ""); };

  htmx.on("htmx:beforeRequest", function (evt) {
    var d = evt.detail;
    var elt = d.elt;
    if (elt && elt.tagName === "FORM" && d.xhr) { sentEdits.set(d.xhr, edits.get(elt) || 0); reqForm.set(d.xhr, elt); }
    if (!isView(elt) || !isGet(d.requestConfig && d.requestConfig.verb)) return;
    // Hidden tabs (finding 5): a tab nobody is looking at does not poll; §5b catches up when it is shown again.
    if (doc.hidden) { evt.preventDefault(); return; }
    if (elt.querySelector("form[data-dirty]")) evt.preventDefault();
  });

  // ── 3b. Edits survive swaps (finding 1: a refresh no longer wipes text typed in flight or in another form) ──
  // Each field is found again in the fresh fragment by (form position among the view's forms, name, index among
  // same-named fields); fields outside any form use position -1. Hidden fields and buttons carry server state: skipped.
  var FIELD = "input, textarea, select";
  var SKIP_TYPES = ["hidden", "submit", "button", "reset", "file", "image"];
  var swapXhr = null, pendingFocus = null;

  function carriable(el) { return !!el.name && SKIP_TYPES.indexOf(String(el.type || "").toLowerCase()) === -1; }
  function list(root, sel) { return root && root.querySelectorAll ? Array.prototype.slice.call(root.querySelectorAll(sel)) : []; }
  function sameNamed(root, form, name) {
    var scope = form || root;
    return list(scope, FIELD).filter(function (f) { return f.name === name && (form || !f.closest("form")); });
  }
  function locate(root, el) {
    var form = el.closest("form");
    var fi = form ? list(root, "form").indexOf(form) : -1;
    return { form: fi, name: el.name, idx: sameNamed(root, form, el.name).indexOf(el) };
  }
  function find(root, loc) {
    var form = null;
    if (loc.form >= 0) { form = list(root, "form")[loc.form]; if (!form) return null; }
    return sameNamed(root, form, loc.name)[loc.idx] || null;
  }
  function copyField(from, to) {
    if (!to || to.tagName !== from.tagName || to.type !== from.type) return;
    if (from.type === "checkbox" || from.type === "radio") to.checked = from.checked;
    else if (from.tagName === "SELECT") {
      if (from.multiple) {
        var picked = Array.prototype.filter.call(from.options, function (o) { return o.selected; }).map(function (o) { return o.value; });
        Array.prototype.forEach.call(to.options, function (o) { o.selected = picked.indexOf(o.value) !== -1; });
      } else {
        var i = from.selectedIndex;
        if (i >= 0 && to.options[i] && to.options[i].value === from.options[i].value) to.selectedIndex = i;
      }
    } else to.value = from.value;
  }

  htmx.on("htmx:oobBeforeSwap", function (evt) {
    var d = evt.detail;
    var target = d.target, fresh = d.fragment;
    if (!target || !target.querySelectorAll || !fresh || !fresh.querySelectorAll) return;
    var active = doc.activeElement;
    var focused = active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName) && target.contains(active) ? active : null;
    // The form whose own request produced this response, if it sent every edit, takes the server's fresh values.
    var own = swapXhr && current(reqForm.get(swapXhr));
    var ownDone = own && sentEdits.get(swapXhr) === (edits.get(own) || 0);
    list(target, FIELD).forEach(function (el) {
      if (!carriable(el)) return;
      var form = el.closest("form");
      var dirty = form && form.hasAttribute("data-dirty");
      if (!dirty && el !== focused) return;
      if (form && form === own && ownDone) return;
      var loc = locate(target, el);
      var to = find(fresh, loc);
      if (!to) return;
      var toForm = to.closest("form");
      // A list that shifted puts a different form at this position: never pour a draft into another action.
      if (form && toForm && form.getAttribute("hx-post") !== toForm.getAttribute("hx-post")) return;
      copyField(el, to);
      if (dirty && toForm) {
        toForm.setAttribute("data-dirty", "1"); edits.set(toForm, edits.get(form) || 0); moved.set(form, toForm);
        if (form.getAttribute("aria-busy") === "true") hold(toForm); // still in flight: §12
      }
    });
    if (focused && focused.name) {
      var loc = locate(target, focused);
      var sel = null;
      try { if (typeof focused.selectionStart === "number") sel = [focused.selectionStart, focused.selectionEnd, focused.selectionDirection]; } catch (e) { sel = null; }
      pendingFocus = { view: target.id, loc: loc, sel: sel };
    }
  });

  function restoreFocus(only) {
    var p = pendingFocus;
    if (!p || (only && only !== p.view)) return;
    var root = p.view ? doc.getElementById(p.view) : null;
    if (!root) return; // not swapped in yet: a later oobAfterSwap or the settle tries again
    pendingFocus = null;
    var el = find(root, p.loc);
    if (!el || doc.activeElement === el) return;
    el.focus({ preventScroll: true });
    if (p.sel) {
      try { el.setSelectionRange(p.sel[0], p.sel[1], p.sel[2] || "none"); } catch (e) { /* input types without a selection */ }
    }
  }
  htmx.on("htmx:oobAfterSwap", function (evt) { var t = evt.detail.target; if (t && t.id) restoreFocus(t.id); });

  // ── 4. Keep <details> open state and scroll positions across swaps (finding 2) ──
  // details[data-keep] are keyed by data-keep; other <details> by (view id, index among the view's details, summary
  // text). [data-keep-scroll][id] keep their place (or stay at the bottom); any other element scrolled down keeps its
  // scrollTop by (view id, index among the view's elements, tag).
  var kept = {};

  function markDefaults(root) {
    each(root, "details[open]", function (d) { d.setAttribute("data-default-open", "1"); });
  }

  function summaryOf(d) {
    var s = d.querySelector ? d.querySelector("summary") : null;
    return s ? String(s.textContent || "").trim() : "";
  }

  function remember(target) {
    if (!target || !target.id) return;
    var s = { open: [], closed: [], popen: [], pclosed: [], scroll: {}, pscroll: {} };
    var i = 0;
    each(target, "details", function (d) {
      var k = d.getAttribute("data-keep");
      var key = k != null ? k : i + "|" + summaryOf(d);
      var open = k != null ? s.open : s.popen, closed = k != null ? s.closed : s.pclosed;
      i++;
      if (d.open) open.push(key);
      else if (d.hasAttribute("data-default-open")) closed.push(key);
    });
    each(target, "[data-keep-scroll][id]", function (el) {
      s.scroll[el.id] = el.scrollHeight - el.scrollTop - el.clientHeight < 60 ? "bottom" : el.scrollTop;
    });
    var n = 0;
    each(target, "*", function (el) {
      var at = n++;
      if (el.scrollTop > 0 && !(el.hasAttribute("data-keep-scroll") && el.id)) s.pscroll[at + "|" + el.tagName] = el.scrollTop;
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
      var i = 0;
      each(el, "details", function (d) {
        var k = d.getAttribute("data-keep");
        var key = k != null ? k : i + "|" + summaryOf(d);
        var open = k != null ? s.open : s.popen, closed = k != null ? s.closed : s.pclosed;
        i++;
        if (open.indexOf(key) !== -1) d.open = true;
        else if (closed.indexOf(key) !== -1) d.open = false;
      });
      Object.keys(s.scroll).forEach(function (sid) {
        var sc = doc.getElementById(sid);
        if (sc) sc.scrollTop = s.scroll[sid] === "bottom" ? sc.scrollHeight : s.scroll[sid];
      });
      if (Object.keys(s.pscroll).length) {
        var n = 0;
        each(el, "*", function (x) {
          var key = n++ + "|" + x.tagName;
          if (Object.prototype.hasOwnProperty.call(s.pscroll, key)) x.scrollTop = s.pscroll[key];
        });
      }
    });
  }

  htmx.on("htmx:oobBeforeSwap", function (evt) { remember(evt.detail.target); });
  // A response that is not swapped (204, or one htmx is told not to swap) never settles: no snapshot, or a
  // later unrelated settle would replay it over the operator's own toggles and scrolling.
  htmx.on("htmx:beforeSwap", function (evt) { if (evt.detail.shouldSwap) remember(evt.detail.target); });
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
      var tsAttr = t.getAttribute("data-ts");
      var ts = tsAttr && tsAttr.trim() ? Number(tsAttr) : NaN; // an empty data-ts is unusable, not 0 (1970)
      if (!Number.isFinite(ts)) return;
      var date = new Date(ts);
      var fmt = t.getAttribute("data-fmt") || "ago";
      var text;
      if (fmt === "local") text = date.toLocaleString();
      else if (fmt === "time") text = date.toLocaleTimeString();
      else if (fmt === "dur") {
        var toAttr = t.getAttribute("data-to");
        var to = toAttr ? Number(toAttr) : NaN; // a missing or empty data-to is a running duration, not 0 (1970)
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

  // ── 7. The error region (finding 3): #weave-error clears after the operator's next successful action ──
  // Only a successful NON-GET request clears it, never a background poll. htmx:oobAfterSwap carries no xhr; its
  // response is the one whose htmx:beforeSwap ran just before. "Next" is by send order: a request sent before the
  // error's request does not clear it, however late it ends.
  var sent = 0, sentSeq = new WeakMap(), errorSeq = 0, errorXhr = null;
  function seqOf(xhr) { var n = xhr && sentSeq.get(xhr); return n === undefined ? sent : n; }
  htmx.on("htmx:beforeRequest", function (evt) { if (evt.detail.xhr) sentSeq.set(evt.detail.xhr, ++sent); });
  htmx.on("htmx:beforeSwap", function (evt) { swapXhr = evt.detail.xhr; });
  function errorSwapped(xhr) { errorSeq = seqOf(xhr); errorXhr = xhr || null; localShown = false; }
  htmx.on("htmx:oobAfterSwap", function (evt) {
    if (evt.detail.target && evt.detail.target.id === "weave-error") errorSwapped(swapXhr);
  });
  htmx.on("htmx:afterSwap", function (evt) {
    if (evt.detail.target && evt.detail.target.id === "weave-error") errorSwapped(evt.detail.xhr);
  });
  // htmx:beforeSwap on an error status: nothing to do — responseHandling already swaps 4xx/5xx.

  // ── 7b. Unreachable weave (finding 4): say so, mark the views stale, and keep retrying ──
  // A request that never reaches weave (network error, 20 s timeout) or a failure response that is not weave's own
  // error fragment gets a local problem in #weave-error; the next successful swap clears it and the stale marks.
  htmx.config.timeout = 20000;
  var lastOk = null, localShown = false, stale = false;

  function firstLoadFailed(elt) {
    if (!isView(elt) || !elt.querySelector) return;
    var note = elt.querySelector("p.note.loading");
    if (note && String(note.textContent || "").trim() === "Loading…") note.textContent = "Could not load — see above.";
  }

  function unreachable(evt) {
    var d = evt.detail;
    firstLoadFailed(d.elt);
    if (evt.type === "htmx:responseError" && d.xhr && d.xhr === errorXhr) return; // weave answered with its own problem
    var err = doc.getElementById("weave-error");
    if (err) {
      var strong = doc.createElement("strong");
      strong.textContent = "Can't reach weave — retrying.";
      var since = lastOk === null ? "Nothing has loaded yet." : "Not updated since " + new Date(lastOk).toLocaleTimeString() + ".";
      err.replaceChildren(strong, doc.createTextNode(" " + since));
      err.setAttribute("role", "alert");
      err.hidden = false;
      localShown = true;
    }
    each(doc, '[id^="view-"]', function (v) { v.setAttribute("data-stale", "true"); });
    stale = true;
  }
  htmx.on("htmx:sendError", unreachable);
  htmx.on("htmx:timeout", unreachable);
  htmx.on("htmx:responseError", unreachable);

  function swappedOk(xhr) {
    if (!xhr || !(xhr.status >= 200 && xhr.status < 300)) return;
    lastOk = Date.now();
    if (stale) { stale = false; each(doc, "[data-stale]", function (v) { v.removeAttribute("data-stale"); }); }
    if (localShown) {
      localShown = false;
      var err = doc.getElementById("weave-error");
      if (err) { err.replaceChildren(); err.hidden = true; }
    }
  }

  // ── 9c / 10 state, shared with afterRequest ──
  var picks = new WeakMap();
  var auditSha = null, auditXhr = null;

  htmx.on("htmx:afterRequest", function (evt) {
    var d = evt.detail;
    var elt = d.elt;
    if (!d.successful) return;
    var sentAt = d.xhr && sentEdits.get(d.xhr);
    var form = elt && elt.tagName === "FORM" ? current(elt) : null;
    if (form && (sentAt === undefined || sentAt === (edits.get(form) || 0))) form.removeAttribute("data-dirty");
    var err = doc.getElementById("weave-error");
    var action = !isGet(d.requestConfig && d.requestConfig.verb);
    if (action && err && !err.hidden && d.xhr && sentSeq.get(d.xhr) > errorSeq) { err.replaceChildren(); err.hidden = true; localShown = false; }
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
  // ADR-0245 §5: only a static shell (served as /ui/assets/pages/<key>.html) needs its links pointed at the other
  // shells; served by weave-ui's own server at /, /work, /task …, the page's links are already its own URLs.
  var staticShell = location.pathname.indexOf("/ui/assets/pages/") === 0;

  function rewriteLinks(root) {
    if (!staticShell) return;
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
    // (b) the static shells link to each other (rewriteLinks does nothing on weave-ui's own server)
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
  // A response that is not swapped (204, or one htmx is told not to swap) never settles: drop the pending check.
  htmx.on("htmx:beforeSwap", function (evt) {
    if (evt.detail.xhr && evt.detail.xhr === auditXhr && !evt.detail.shouldSwap) { auditSha = null; auditXhr = null; }
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

  // After any swap settles: restore kept state and focus, refresh counts, finish an audit check, clear staleness.
  htmx.on("htmx:afterSettle", function (evt) {
    var xhr = evt.detail && evt.detail.xhr;
    restore();
    restoreFocus();
    updateCounts();
    auditResult(xhr);
    swappedOk(xhr);
  });

  // ── 11. Hidden tabs (finding 5): once the tab is shown again, every view catches up at once ──
  doc.addEventListener("visibilitychange", function () {
    if (doc.hidden) return;
    each(doc, '[id^="view-"][hx-get]', function (el) {
      var url = el.getAttribute("hx-get");
      if (url) htmx.ajax("GET", url, { source: el, swap: "none" });
    });
  });

  // ── 12. Pending (finding 6): a form in flight is aria-busy with its buttons disabled, so Enter cannot send twice ──
  // Registered last, so a request another handler cancelled is never marked. Only buttons this disabled are re-enabled.
  // §3b holds the fresh form a still-pending draft is carried into as well, so the form on the page is the busy one.
  var busy = new WeakMap(), held = new WeakMap();
  function hold(form) {
    var buttons = list(form, "button").filter(function (b) { return !b.disabled; });
    buttons.forEach(function (b) { b.disabled = true; });
    form.setAttribute("aria-busy", "true");
    held.set(form, buttons);
  }
  function release(form) {
    form.removeAttribute("aria-busy");
    (held.get(form) || []).forEach(function (b) { b.disabled = false; });
    held.delete(form);
  }
  htmx.on("htmx:beforeRequest", function (evt) {
    var d = evt.detail;
    var form = d.elt;
    if (evt.defaultPrevented || !form || form.tagName !== "FORM" || !d.xhr) return;
    hold(form);
    busy.set(d.xhr, form);
  });
  htmx.on("htmx:afterRequest", function (evt) {
    var form = evt.detail.xhr && busy.get(evt.detail.xhr);
    if (!form) return;
    busy.delete(evt.detail.xhr);
    release(form);
    if (current(form) !== form) release(current(form));
  });
  // requestSubmit (Enter) ignores disabled buttons: stop a busy form's submit before htmx sees it.
  doc.addEventListener("submit", function (e) {
    var form = e.target;
    if (form && form.getAttribute && form.getAttribute("aria-busy") === "true") { e.preventDefault(); e.stopPropagation(); }
  }, true);
})();
