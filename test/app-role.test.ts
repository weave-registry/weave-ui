/**
 * app.js additions for the Team role editor: the `:csv[]` field type (a comma list as an array of trimmed,
 * non-empty strings), and the editor's add-a-file / remove-a-file fields folded into define[files] at request time.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { ROOT } from "./helpers.js";

interface Ext {
  encodeParameters?: (xhr: unknown, params: FormData, elt: unknown) => unknown;
  onEvent?: (name: string, evt: unknown) => unknown;
}

function ext(): Ext {
  const exts: Record<string, Ext> = {};
  const noop = (): void => {};
  const el = { getAttribute: () => null, setAttribute: noop, dataset: {}, querySelectorAll: () => [], addEventListener: noop, closest: () => null };
  const sandbox: Record<string, unknown> = {
    htmx: { defineExtension: (n: string, e: Ext) => void (exts[n] = e), on: noop, process: noop, config: {} },
    document: { addEventListener: noop, querySelectorAll: () => [], querySelector: () => null, body: el, documentElement: el, activeElement: null, readyState: "loading" },
    location: { search: "", pathname: "/ui/assets/pages/team.html", hash: "" },
    setInterval: noop, clearInterval: noop, setTimeout: noop, Intl, Date,
  };
  sandbox.window = { ...sandbox, addEventListener: noop, confirm: () => true };
  vm.runInNewContext(readFileSync(join(ROOT, "assets-src", "app.js"), "utf8"), sandbox);
  return exts["weave-json"]!;
}

const encode = (entries: [string, string][], elt: unknown = {}): unknown => {
  const fd = new FormData();
  for (const [k, v] of entries) fd.append(k, v);
  return JSON.parse(ext().encodeParameters!({ overrideMimeType: () => {} }, fd, elt) as string);
};

test(":csv[] splits a comma list into trimmed, non-empty strings", () => {
  assert.deepEqual(encode([["define[skills]:csv[]", " research, sdlc-* ,,"]]), { define: { skills: ["research", "sdlc-*"] } });
  assert.deepEqual(encode([["define[skills]:csv[]", ""]]), { define: { skills: [] } });
});

test("a new file: define-new-path names it, define-new-body is its text, added under define[files]", () => {
  assert.deepEqual(
    encode([["define[name]", "copy"], ["define[files][persona.md]", "p"], ["@new-file:path", "style-guide.md"], ["@new-file:body", "# Style"]]),
    { define: { name: "copy", files: { "persona.md": "p", "style-guide.md": "# Style" } } },
  );
  assert.deepEqual(encode([["define[files][a.md]", "a"], ["@new-file:path", ""], ["@new-file:body", "ignored"]]), { define: { files: { "a.md": "a" } } });
});

test("a new file's path must be a plain relative name (letters, digits, dot, dash, underscore, and skills/<name>/SKILL.md)", () => {
  for (const bad of ["../x.md", "/etc/passwd", "a/b.md", "__proto__", ".hidden"]) {
    const out = encode([["define[files][a.md]", "a"], ["@new-file:path", bad], ["@new-file:body", "x"]]) as { define: { files: Record<string, string> } };
    assert.deepEqual(Object.keys(out.define.files), ["a.md"], bad);
  }
  assert.deepEqual(Object.keys((encode([["@new-file:path", "skills/tone/SKILL.md"], ["@new-file:body", "t"]]) as { define: { files: Record<string, string> } }).define.files), ["skills/tone/SKILL.md"]);
});

test("@remove-file drops that file from define[files]", () => {
  assert.deepEqual(encode([["define[files][a.md]", "a"], ["define[files][b.md]", "b"], ["@remove-file", "b.md"]]), { define: { files: { "a.md": "a" } } });
});

test("a new file's text with an empty or rejected path blocks the save and tells the operator, instead of being dropped", () => {
  const send = (path: string, body: string): { sent: boolean; warned: string } => {
    let warned = "";
    let sent = true;
    const input = { setCustomValidity: (m: string) => void (warned = m), reportValidity: () => true };
    const form = { querySelector: (sel: string) => (sel === '[name="@new-file:path"]' ? input : null) };
    const params = new FormData();
    params.append("define[name]", "copy");
    params.append("@new-file:path", path);
    params.append("@new-file:body", body);
    const evt = { detail: { verb: "post", elt: form, parameters: params, headers: {} as Record<string, string> }, preventDefault: () => void (sent = false) };
    if (ext().onEvent!("htmx:configRequest", evt) === false) sent = false;
    return { sent, warned };
  };
  for (const bad of ["", "my notes.md", "notes/style.md", "skills/MySkill/SKILL.md", "__proto__"]) {
    const r = send(bad, "# my text");
    assert.equal(r.sent, false, `sent with path ${JSON.stringify(bad)}`);
    assert.notEqual(r.warned, "", `no warning for path ${JSON.stringify(bad)}`);
  }
  assert.deepEqual(send("", ""), { sent: true, warned: "" });
  assert.deepEqual(send("style-guide.md", "# Style"), { sent: true, warned: "" });
  assert.deepEqual(send("skills/tone/SKILL.md", "t"), { sent: true, warned: "" });
});
