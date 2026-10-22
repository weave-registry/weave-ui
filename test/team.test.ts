/** The `team` template at parity with weave's Team page (docs/parity/factory-machines-team.md, ## Team). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { templates } from "../src/templates/index.js";
import { CTX, ROOT } from "./helpers.js";

const fx = (n: string): unknown => JSON.parse(readFileSync(join(ROOT, "test", "fixtures", `${n}.json`), "utf8"));
const team = (vm: unknown): string => (templates as Record<string, (v: unknown, c: unknown) => string>).team!(vm, CTX);
const full = team(fx("team.full"));

test("root: #view-team, polled, out of band; the sidebar's Team value comes from Home, not from here", () => {
  const r = /^<section [^>]*>/.exec(full)?.[0] ?? "";
  for (const a of [`id="view-team"`, `hx-get="/ui/f/team"`, `hx-trigger="every 15s"`, `hx-swap="none"`, `hx-swap-oob="true"`])  assert.ok(r.includes(a), `${a} in ${r}`);
  assert.doesNotMatch(r, /data-nav-count/);
  assert.match(full, /<h1>Team<\/h1>/);
  assert.ok(full.includes("4 roles, 2 of them yours (up to 12)."));
});

test("refused role files", () => {
  assert.ok(full.includes("broken&#39;s files were not accepted"));
  assert.match(full, /<ul class="errors"><li>persona\.md: no frontmatter<\/li>/);
});

test("role cards: source badge, workers, meta, files table, actions", () => {
  assert.match(full, /<span class="badge" data-tone="ok">yours<\/span>/);
  assert.match(full, /<span class="badge" data-tone="ok">yours · replaces shipped<\/span>/);
  assert.match(full, /<span class="badge" data-tone="">shipped<\/span>/);
  assert.ok(full.includes("No worker running — work sent to this role waits"));
  assert.ok(full.includes("1 worker, 1 working"));
  assert.ok(full.includes("Tools: write_file, edit_file"));
  assert.ok(full.includes("Tools: everything its worker is granted"));
  assert.ok(full.includes("Its own skills: tone"));
  assert.ok(full.includes("Fleet skills: research"));
  assert.ok(full.includes("Budget: $1.50 a task"));
  assert.match(full, /<table class="table files">/);
  assert.match(full, /<td>Who it is<\/td>/);
  assert.match(full, /data-confirm="Retire copywriter\? Its worker stops after what it is doing now, and work sent to it waits\. Its files are removed; what it made in work\/ stays\."><input type="hidden" name="retire" value="copywriter">/);
  assert.match(full, /data-confirm="Retire designer\?[^"]* The shipped designer comes back\."/);
});

test("editor: define posts the role with typed fields; shipped roles offer a copy; a new role starts from the starter", () => {
  assert.match(full, /<form class="role-editor" hx-post="\/ui\/a\/role" hx-swap="none" data-role-editor>/);
  assert.match(full, /<input type="hidden" name="define\[name\]" value="copywriter">/);
  assert.match(full, /<input name="define\[purpose\]" [^>]*value="Writes the words on a page\.">/);
  assert.match(full, /<input type="checkbox" name="define\[tools\]:str\[\]" value="[a-z_]+"/);
  assert.match(full, /<input name="define\[skills\]:csv\[\]" [^>]*value="research">/);
  assert.match(full, /<input name="define\[budgetUsd\]:num" [^>]*value="1\.5">/);
  assert.match(full, /<textarea name="define\[files\]\[skills\/tone\/SKILL\.md\]"/);
  assert.match(full, />Replace with my own</);
  assert.match(full, /<input type="hidden" name="define\[overrides\]:bool" value="true">/);
  assert.match(full, /<summary class="btn primary">New role<\/summary>/);
  assert.doesNotMatch(full, /data-key="developer"[^]*Replace with my own[^]*data-key="designer"/);
});

test("editor: editing a role that replaces a shipped one posts overrides, so the save is not refused", () => {
  const form = (key: string): string => new RegExp(`<details class="editor" data-keep="${key}">[^]*?</details>`).exec(full)?.[0] ?? "";
  const designer = form("edit:designer");
  assert.ok(designer !== "", "designer has an edit form");
  assert.match(designer, /<input type="hidden" name="define\[overrides\]:bool" value="true">/);
  const copywriter = form("edit:copywriter");
  assert.ok(copywriter !== "", "copywriter has an edit form");
  assert.doesNotMatch(copywriter, /define\[overrides\]/);
});

test("editor: a file starting with a blank line keeps it, since the parser drops one newline after <textarea>", () => {
  const vm = JSON.parse(JSON.stringify(fx("team.full")).replace('"# Tone\\nBe brief."', '"\\n# Tone\\nBe brief."'));
  assert.match(team(vm), /<textarea name="define\[files\]\[skills\/tone\/SKILL\.md\]" rows="8">\n\n# Tone\nBe brief\.<\/textarea>/);
  for (const m of full.matchAll(/<textarea name="define\[files\][^>]*>(.)/g)) assert.equal(m[1], "\n", "every file textarea opens with the newline the parser drops");
});
