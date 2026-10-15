/** The `audit` template at parity with weave's Full record (/audit; docs/parity/task-audit.md, ## Audit). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { templates } from "../src/templates/index.js";
import { CTX, ROOT } from "./helpers.js";

const fx = (n: string): unknown => JSON.parse(readFileSync(join(ROOT, "test", "fixtures", `${n}.json`), "utf8"));
const audit = (vm: unknown): string => (templates as Record<string, (v: unknown, c: unknown) => string>).audit!(vm, CTX);
const search = audit(fx("audit.search"));
const one = audit(fx("audit.task"));
const win = audit(fx("audit.window"));

test("root: #view-audit, out of band, not polled, re-reads its own selector for the check", () => {
  const r = /^<section [^>]*>/.exec(one)?.[0] ?? "";
  for (const a of [`id="view-audit"`, `hx-swap-oob="true"`]) assert.ok(r.includes(a), `${a} in ${r}`);
  assert.doesNotMatch(r, /hx-trigger="every/);
  assert.match(one, /<button class="btn" type="button" data-audit-check hx-get="\/ui\/f\/audit\?id=task-[0-9a-f]+" hx-swap="none">Check this record<\/button>/);
  assert.match(win, /hx-get="\/ui\/f\/audit\?since=\d+&amp;until=\d+"/);
  // A search re-read pins the report's absolute bounds, or the gateway re-resolves "last 7 days" from now and the sha differs.
  assert.match(search, /hx-get="\/ui\/f\/audit\?find=release%20notes&amp;since=1792015977608&amp;until=1792102377608"/);
});

test("summary card: the selector's title, status line, cost line, notes, the sha", () => {
  assert.match(one, /<div class="card-title">Task task-[0-9a-f]+<\/div>/);
  assert.match(search, /<div class="card-title">Search “release notes”<\/div>/);
  assert.match(search, /<div class="status" data-tone="bad">5 tasks — 5 done, 1 failed, 1 still open<\/div>/);
  assert.ok(search.includes("$1.23 by weave + $0.50 by hexa · 15k tokens"));
  assert.ok(search.includes("thread x: no turns on this replica"));
  assert.match(one, /<span class="seq" data-audit-sha="[0-9a-f]{64}" title="[0-9a-f]{64}">sha256 [0-9a-f]{16}…<\/span>/);
  assert.match(one, /<span class="result" data-audit-result role="status"><\/span>/);
});

test("sections: matches, what went wrong, conflicting answers, corrected, said no, tasks", () => {
  assert.match(search, /<summary>Matches \(1\)<\/summary>/);
  assert.ok(search.includes(" · goal · score 0.87"));
  assert.match(search, /<summary>What went wrong \(\d+\)<\/summary>/);
  assert.match(search, /<span class="kind">A tool call failed<\/span>/);
  assert.match(search, /<span class="seq">#20 · #21<\/span>/);
  assert.match(search, /<summary>Conflicting answers \(1\)<\/summary>/);
  assert.ok(search.includes("The answer names a different file than the one the agent wrote"));
  assert.match(search, /<summary>Weave corrected the agent \(1\)<\/summary>/);
  assert.ok(search.includes("It gave an empty answer; weave asked again"));
  assert.match(search, /<summary>You said no to \(1\)<\/summary>/);
  assert.ok(search.includes("You denied a call"));
  assert.match(one, /<summary>Tasks \(1\)<\/summary>/);
  assert.match(one, /<a href="\/task\?id=task-[0-9a-f]+">task-[0-9a-f]+<\/a>/);
});

test("sections: cost, models, prompts, memory, every step — closed, with show-more past ten", () => {
  assert.match(search, /<details class="sec" data-keep="cost"><summary>Cost<\/summary>/);
  assert.ok(search.includes("hexa, 2 calls"));
  assert.match(win, /<summary>Models \(\d+\)<\/summary>/);
  assert.match(win, /<summary>What each agent was sent \(\d+\)<\/summary>/);
  assert.match(win, /<summary>Every step \(\d+\)<\/summary>/);
  assert.match(win, /<summary>Show \d+ more<\/summary>/);
  assert.match(win, /<pre class="goal">/);
});
