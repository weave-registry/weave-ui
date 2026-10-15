/**
 * ADR-0234 §4's hostile-fixture shape test. Every string leaf of every fixture is set in turn to each payload of
 * weave's corpus (vendor/weave/html-shape.ts, byte-identical to weave's). The render's element and attribute
 * shape — tags, attribute names, and where an hx-* attribute sends its request — must equal the shape of a render
 * with that same leaf set to a neutral word. Comparing against the same leaf, neutralised, means an enum's
 * unknown-value branch is compared with itself; what is proved is that a payload's content never adds, removes or
 * retargets structure.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { HOSTILE_PAYLOADS, htmlShape, sameShape } from "../vendor/weave/html-shape.js";
import { templates } from "../src/templates/index.js";
import { CTX, VIEW_TEMPLATES, fixtures } from "./helpers.js";

const NEUTRAL = "x";

function leaves(v: unknown): number {
  if (typeof v === "string") return 1;
  if (Array.isArray(v)) return v.reduce((n: number, x: unknown) => n + leaves(x), 0);
  if (v !== null && typeof v === "object") return Object.values(v).reduce((n: number, x: unknown) => n + leaves(x), 0);
  return 0;
}

function setLeaf(v: unknown, target: number, value: string, at = { n: 0 }): unknown {
  if (typeof v === "string") return at.n++ === target ? value : v;
  if (Array.isArray(v)) return v.map((x) => setLeaf(x, target, value, at));
  if (v !== null && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, setLeaf(x, target, value, at)]));
  return v;
}

const T = templates as Record<string, (vm: unknown, ctx: unknown) => string>;

test("templates: the names weave renders, plus error — nothing else", () => {
  for (const name of Object.keys(T)) assert.ok([...VIEW_TEMPLATES, "error"].includes(name as never), `unexpected template '${name}'`);
  assert.ok("error" in T);
});

test("every template has at least one fixture", () => {
  const have = new Set(fixtures().map((f) => f.template));
  for (const name of Object.keys(T)) assert.ok(have.has(name), `no fixture for '${name}' (test/fixtures/${name}.<case>.json)`);
});

test("the render context's strings are hostile-safe too (nav labels, user)", () => {
  for (const f of fixtures()) {
    const fn = T[f.template]!;
    const ctxLeaves = leaves(CTX);
    for (let k = 0; k < ctxLeaves; k++) {
      const ref = fn(f.vm, setLeaf(CTX, k, NEUTRAL));
      for (const p of HOSTILE_PAYLOADS) {
        const out = fn(f.vm, setLeaf(CTX, k, p));
        assert.ok(sameShape(ref, out), `${f.template}.${f.name}: ctx leaf ${k} = ${JSON.stringify(p.slice(0, 40))}\n${htmlShape(ref).join(" ")}\n${htmlShape(out).join(" ")}`);
      }
    }
  }
});

test("every string leaf of every fixture, set to every hostile payload, keeps the shape", () => {
  let checked = 0;
  for (const f of fixtures()) {
    const fn = T[f.template];
    assert.ok(fn, `no template '${f.template}'`);
    const benign = fn(f.vm, CTX);
    assert.ok(htmlShape(benign).length > 0, `${f.template}.${f.name} renders markup`);
    const n = leaves(f.vm);
    for (let k = 0; k < n; k++) {
      const ref = fn(setLeaf(f.vm, k, NEUTRAL), CTX);
      for (const p of HOSTILE_PAYLOADS) {
        const out = fn(setLeaf(f.vm, k, p), CTX);
        checked++;
        if (!sameShape(ref, out)) {
          const a = htmlShape(ref);
          const b = htmlShape(out);
          const i = a.findIndex((t, j) => t !== b[j]);
          assert.fail(`${f.template}.${f.name}: leaf ${k} = ${JSON.stringify(p.slice(0, 40))} changes the shape at token ${i}: ${a[i]} vs ${b[i]}`);
        }
      }
    }
  }
  assert.ok(checked > 0);
});
