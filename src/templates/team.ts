import type { TeamViewModel, RenderCtx } from "../../contract/console-views-v1.js";
import { html, toHtml, type SafeHtml } from "../html.js";
import { money, plural, time, str, num } from "../ui/format.js";
import { actionForm } from "../ui/actions.js";
import { markdown } from "../markdown.js";

/**
 * The `team` template: weave's Team page (`/team`) as one out-of-band htmx fragment, at parity with weave's
 * team-page.ts (docs/parity/factory-machines-team.md, ## Team): the head, refused role folders, a card per role
 * with its files, and the role editor as a form per role whose fields carry the weave-json encoder's types.
 *
 * Markup is built only with the one `html` tag (ADR-0234 §4). The view model is untrusted JSON: every field is
 * read through a guard, so a missing or wrong-typed field renders less and never throws. A role's text lands
 * only in text content and quoted attribute values.
 * Pure and synchronous; `ctx` is unused.
 */
export function team(vm: TeamViewModel, ctx: RenderCtx): string {
  void ctx;
  const v = rec(vm);
  const roles = arr(v["roles"]).map(rec);
  const refused = arr(v["refused"]).map(rec);
  const tools = strs(v["tools"]);
  const starter = rec(v["starter"]);
  const mine = roles.filter((r) => r["source"] !== "shipped").length;
  const idle = roles.filter((r) => r["source"] !== "shipped" && n0(r["workers"]) === 0).length;
  const summary = `${plural(roles.length, "role")}, ${mine} of them yours (up to ${n0(v["maxRoles"])}).`;

  return toHtml(
    html`<section id="view-team" class="view team" hx-get="/ui/f/team" hx-trigger="every 15s" hx-swap="none" hx-swap-oob="true" data-nav-count="team:${idle + refused.length}"><div class="page-head"><h1>Team</h1><span class="sub" id="summary">${summary}</span></div><div id="refused">${refused.map(refusedCard)}</div><div id="roles"><div class="role-actions">${newRole(tools, starter)}</div>${cardOrder(roles).map((r) => roleCard(r, tools))}</div></section>`,
  );
}

// ---- guards ----

type Rec = Readonly<Record<string, unknown>>;

function rec(x: unknown): Rec {
  return typeof x === "object" && x !== null && !Array.isArray(x) ? (x as Rec) : {};
}

function arr(x: unknown): readonly unknown[] {
  return Array.isArray(x) ? x : [];
}

function strs(x: unknown): string[] {
  return arr(x).filter((s): s is string => typeof s === "string");
}

function n0(x: unknown): number {
  return num(x) ?? 0;
}

/** A role's files as path → text, keeping only string values; undefined when it has none. */
function filesOf(x: unknown): Record<string, string> | undefined {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, t] of Object.entries(x as Rec)) if (typeof t === "string") out[k] = t;
  return out;
}

// ---- 2. refused ----

function refusedCard(f: Rec): SafeHtml {
  const errors = strs(f["errors"]);
  return html`<div class="card needs"><div class="card-title">${`${str(f["name"])}'s files were not accepted`}</div><div class="card-why">The last good version keeps running. Fix the files and save again:</div><ul class="errors">${errors.map((e) => html`<li>${e}</li>`)}</ul></div>`;
}

// ---- 3. role cards ----

/** Your roles first, then the shipped ones, each group in the view model's order. */
function cardOrder(roles: readonly Rec[]): Rec[] {
  return [...roles.filter((r) => r["source"] !== "shipped"), ...roles.filter((r) => r["source"] === "shipped")];
}

const SOURCE: Readonly<Record<string, string>> = { shipped: "shipped", yours: "yours", "replaces-shipped": "yours · replaces shipped" };

function sourceText(s: string): string {
  return Object.prototype.hasOwnProperty.call(SOURCE, s) ? (SOURCE[s] ?? s) : s;
}

function workersLine(r: Rec): SafeHtml {
  const workers = n0(r["workers"]);
  const working = n0(r["working"]);
  if (workers === 0) return html`<div class="status" data-tone="needs">No worker running — work sent to this role waits</div>`;
  return html`<div class="status" data-tone="${working > 0 ? "work" : "ok"}">${plural(workers, "worker")}${working > 0 ? `, ${working} working` : ", idle"}</div>`;
}

function metaLines(r: Rec, files: Record<string, string> | undefined): SafeHtml {
  const tools = strs(r["tools"]);
  const own = files !== undefined ? Object.keys(files).filter((p) => p.startsWith("skills/")).map((p) => p.split("/")[1] ?? "") : [];
  const skills = strs(r["skills"]);
  const model = str(r["model"]);
  const budget = num(r["budgetUsd"]);
  const by = str(r["by"]);
  const lines: string[] = [tools.length > 0 ? `Tools: ${tools.join(", ")}` : "Tools: everything its worker is granted"];
  if (own.length > 0) lines.push(`Its own skills: ${own.join(", ")}`);
  if (skills.length > 0) lines.push(`Fleet skills: ${skills.join(", ")}`);
  if (model !== "") lines.push(`Model: ${model}`);
  if (budget !== undefined && budget !== 0) lines.push(`Budget: ${money(budget)} a task`);
  const changed = by !== "" ? html`<div class="role-meta">Changed by ${by} · ${time(r["ts"], { fmt: "local" })}</div>` : "";
  return html`${lines.map((l) => html`<div class="role-meta">${l}</div>`)}${changed}`;
}

function retireForm(name: string, source: string): SafeHtml {
  const back = source === "replaces-shipped" ? ` The shipped ${name} comes back.` : "";
  return actionForm(
    { role: { retire: name } },
    {
      label: "Retire",
      tone: "danger",
      confirm: `Retire ${name}? Its worker stops after what it is doing now, and work sent to it waits. Its files are removed; what it made in work/ stays.${back}`,
    },
  );
}

function roleCard(r: Rec, tools: readonly string[]): SafeHtml {
  const name = str(r["name"]);
  const source = str(r["source"]);
  const files = filesOf(r["files"]);
  let actions: SafeHtml | "" = "";
  if (source === "shipped") {
    if (name !== "developer") actions = html`<div class="role-actions">${editor("copy", r, tools, {})}</div>`;
  } else {
    actions = html`<div class="role-actions">${editor("edit", r, tools, {})}${retireForm(name, source)}</div>`;
  }
  return html`<div class="card" data-key="${name}"><div class="role-head"><span class="card-title">${name}</span><span class="badge" data-tone="${source === "shipped" ? "" : "ok"}">${sourceText(source)}</span></div><div class="card-why">${str(r["purpose"])}</div>${workersLine(r)}${metaLines(r, files)}${actions}${filesBlock(r, files)}</div>`;
}

// ---- files table ----

function rank(p: string): number {
  return p === "persona.md" ? 0 : p === "AGENTS.md" ? 1 : p.startsWith("skills/") ? 2 : 3;
}

/** persona.md, then AGENTS.md, then skills/*, then the rest, alphabetical within each group. */
function ordered(paths: readonly string[]): string[] {
  return paths.slice().sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));
}

function kindOf(p: string): string {
  return p === "persona.md" ? "Who it is" : p === "AGENTS.md" ? "How it works" : p.startsWith("skills/") ? "Skill" : "Given to it";
}

/** UTF-8 byte length, counted from UTF-16 code units. */
function utf8Bytes(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        n += 4;
        i++;
      } else n += 3;
    } else n += 3;
  }
  return n;
}

function size(t: string): string {
  const b = utf8Bytes(t);
  return b < 1024 ? `${b} B` : `${(b / 1024).toFixed(1)} KB`;
}

const FRONTMATTER = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/;

/** A file as the reader sees it: frontmatter shown plainly above, the markdown rendered below. */
function rendered(text: string): SafeHtml {
  const m = FRONTMATTER.exec(text.trim());
  if (m === null) return html`<div class="md">${markdown(text)}</div>`;
  return html`<pre class="fm">${m[1] ?? ""}</pre><div class="md">${markdown(m[2] ?? "")}</div>`;
}

function filesBlock(r: Rec, own: Record<string, string> | undefined): SafeHtml | "" {
  const shippedMd = r["markdown"];
  const files = own ?? (typeof shippedMd === "string" ? { "persona.md": shippedMd } : undefined);
  if (files === undefined) return "";
  const name = str(r["name"]);
  const folder = str(r["folder"]);
  const rows = ordered(Object.keys(files)).map((p) => {
    const text = files[p] ?? "";
    return html`<tr><td class="fname">${p}</td><td>${kindOf(p)}</td><td class="num">${size(text)}</td><td><details data-keep="${`view:${name}/${p}`}"><summary>View</summary><div class="doc">${rendered(text)}</div></details></td></tr>`;
  });
  const path = folder !== "" ? html`<span class="path"> · ${folder}</span>` : "";
  return html`<div class="files-block"><div class="role-meta">Files${path}</div><div class="table-wrap"><table class="table files"><thead><tr><th>File</th><th class="kind">Kind</th><th class="num">Size</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

// ---- 4. editor ----

type Mode = "edit" | "copy" | "new";

const NEW_FILE_HINT = "style-guide.md or skills/<name>/SKILL.md";

function field(label: string, hint: string, input: SafeHtml): SafeHtml {
  return html`<div><label class="lbl">${label} <span class="hint">— ${hint}</span>${input}</label></div>`;
}

function toolBoxes(all: readonly string[], have: readonly string[]): SafeHtml {
  if (all.length === 0) {
    return html`<p class="note">This weave is not running a team, so there are no tools to give. Start it with weave dev.</p>`;
  }
  return html`<div class="tools">${all.map((t) =>
    have.includes(t)
      ? html`<label><input type="checkbox" name="define[tools]:str[]" value="${t}" checked>${t}</label>`
      : html`<label><input type="checkbox" name="define[tools]:str[]" value="${t}">${t}</label>`,
  )}</div>`;
}

/** The files the editor opens on: a role's own (persona.md as its body), a copy's persona body, or the starter. */
function editorFiles(mode: Mode, r: Rec, starter: Rec): Record<string, string> {
  const identity = r["identity"];
  if (mode === "new") return { "persona.md": str(starter["persona"]), "AGENTS.md": str(starter["agents"]) };
  if (mode === "copy") return { "persona.md": str(identity) };
  const files: Record<string, string> = { ...(filesOf(r["files"]) ?? {}) };
  files["persona.md"] = typeof identity === "string" ? identity : (files["persona.md"] ?? "");
  return files;
}

function fileFields(files: Record<string, string>): SafeHtml {
  return html`${ordered(Object.keys(files)).map((p) => {
    const persona = p === "persona.md";
    const note = persona ? html`<span class="hint"> — its body; the settings above are its frontmatter</span>` : "";
    const remove =
      persona || p === "AGENTS.md"
        ? ""
        : html`<label class="check"><input type="checkbox" name="@remove-file" value="${p}">Remove this file when I save</label>`;
    return html`<div><label><span class="path">${p}</span>${note}<textarea name="${`define[files][${p}]`}" rows="8">\n${files[p] ?? ""}</textarea></label>${remove}</div>`;
  })}`;
}

function editor(mode: Mode, r: Rec, tools: readonly string[], starter: Rec): SafeHtml {
  const name = str(r["name"]);
  const budget = num(r["budgetUsd"]);
  const nameField =
    mode === "new"
      ? field("Name", "lowercase, with dashes", html`<input name="define[name]" type="text" maxlength="40" placeholder="copywriter" autocomplete="off" required>`)
      : html`<input type="hidden" name="define[name]" value="${name}">`;
  const overrides =
    mode === "copy" || (mode === "edit" && str(r["source"]) === "replaces-shipped") ? html`<input type="hidden" name="define[overrides]:bool" value="true">` : "";
  const title = mode === "edit" ? `Edit ${name}` : mode === "copy" ? `Replace ${name} with your own` : "New role";
  const note =
    mode === "copy"
      ? html`<p class="note">You are editing a copy of the shipped ${name}. Saving makes it yours: it replaces the shipped one until you retire it, and the shipped files are not changed.</p>`
      : "";
  const summary =
    mode === "new"
      ? html`<summary class="btn primary">New role</summary>`
      : html`<summary class="btn">${mode === "edit" ? "Edit" : "Replace with my own"}</summary>`;
  const keep = mode === "new" ? "new-role" : `${mode}:${name}`;
  const save = mode === "edit" ? "Save changes" : mode === "copy" ? "Save my copy" : "Make role";

  return html`<details class="editor" data-keep="${keep}">${summary}<form class="role-editor" hx-post="/ui/a/role" hx-swap="none" data-role-editor><div class="card-title">${title}</div>${note}<div class="form">${nameField}${overrides}${field(
    "What it is for",
    "one sentence; this is also how work is routed to it",
    html`<input name="define[purpose]" type="text" maxlength="300" placeholder="Writes the words on a page: headlines, buttons, short copy." value="${str(r["purpose"])}">`,
  )}<div><span class="lbl">Tools <span class="hint">— the only tools it is offered; pick at least one</span></span>${toolBoxes(tools, strs(r["tools"]))}</div><div class="pair">${field(
    "Fleet skills",
    "names or patterns, comma separated; optional",
    html`<input name="define[skills]:csv[]" type="text" placeholder="research, sdlc-*" value="${strs(r["skills"]).join(", ")}">`,
  )}<div class="pair">${field("Model", "optional", html`<input name="define[model]" type="text" maxlength="80" placeholder="the fleet's default" value="${str(r["model"])}">`)}${field(
    "Budget per task, $",
    "optional",
    html`<input name="define[budgetUsd]:num" type="text" inputmode="decimal" placeholder="the fleet's default" value="${budget !== undefined && budget !== 0 ? String(budget) : ""}">`,
  )}</div></div><div><span class="lbl">Files <span class="hint">— persona.md is who it is, AGENTS.md how it works, skills/ its own skills, and any other file is given to it too</span></span>${fileFields(editorFiles(mode, r, starter))}</div><div class="add-file"><label class="lbl">Add a file <span class="hint">— a path, then its text</span><input name="@new-file:path" type="text" placeholder="${NEW_FILE_HINT}" autocomplete="off"></label><textarea name="@new-file:body" rows="4"></textarea></div><div class="role-actions"><button class="btn primary" type="submit">${save}</button></div></div></form></details>`;
}

function newRole(tools: readonly string[], starter: Rec): SafeHtml {
  return editor("new", {}, tools, starter);
}
