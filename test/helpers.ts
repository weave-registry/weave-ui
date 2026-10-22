/**
 * Test helpers: the built bundle, the fixtures, and a node:vm load that copies weave's loader options
 * (weave src/adapters/secondary/console-ui-bundle.ts at c4e6e3a7 — copied semantics, no weave import).
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const DIST = join(ROOT, "dist");

/** The render context weave passes (src/domain/console-api.ts CORE_NAV at c4e6e3a7). */
export const CTX = {
  api: "1.2",
  nav: [
    { key: "home", label: "Home", path: "/" },
    { key: "work", label: "Work", path: "/work" },
    { key: "control", label: "Control", path: "/control" },
    { key: "factory", label: "Factory", path: "/factory" },
    { key: "machines", label: "Machines", path: "/machines" },
    { key: "team", label: "Team", path: "/team" },
    { key: "audit", label: "Audit", path: "/audit" },
  ],
  user: "gary",
} as const;

/** The template names weave renders by (console-api.ts CONSOLE_VIEWS[].template) plus `error`. */
export const VIEW_TEMPLATES = ["home", "work", "control", "machines", "fleet", "team", "task", "audit", "factory"] as const;

/** Fixtures: test/fixtures/<template>.<case>.json → { template, name, vm }. */
export function fixtures(): { template: string; name: string; vm: unknown }[] {
  const dir = join(ROOT, "test", "fixtures");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const [template, ...rest] = f.slice(0, -".json".length).split(".");
      return { template: template!, name: rest.join(".") || "default", vm: JSON.parse(readFileSync(join(dir, f), "utf8")) as unknown };
    });
}

/** Every file under `dir`, as "/"-separated paths relative to it. */
export function walk(dir: string): string[] {
  const out: string[] = [];
  const go = (d: string): void => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) go(p);
      else out.push(relative(dir, p).split("\\").join("/"));
    }
  };
  if (existsSync(dir)) go(dir);
  return out.sort();
}

export interface VmBundle {
  readonly names: string[];
  render(name: string, model: unknown, ctx?: unknown, timeoutMs?: number): string;
}

/**
 * Loads dist/templates.js the way weave's loader does: a null-prototype sandbox, code generation from strings and
 * wasm off, microtasks inside the evaluation, V8's console deleted, `templates` read by descriptor as a data property,
 * and every render passing its inputs as JSON string literals parsed inside the context.
 */
export function loadBundle(src = readFileSync(join(DIST, "templates.js"), "utf8")): VmBundle {
  const sandbox = Object.create(null) as object;
  const ctx = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false }, microtaskMode: "afterEvaluate" });
  new vm.Script("delete this.console;").runInContext(ctx);
  new vm.Script(src, { filename: "templates.js" }).runInContext(ctx, { timeout: 1000, displayErrors: false });
  const d = Object.getOwnPropertyDescriptor(sandbox, "templates");
  if (d === undefined || !("value" in d) || d.value === null || typeof d.value !== "object") {
    throw new Error("templates.js leaves no top-level `templates` data property on the global");
  }
  const names = new vm.Script("Object.keys(templates).filter(function (k) { return typeof templates[k] === 'function'; }).join(',')").runInContext(ctx) as string;
  return {
    names: names === "" ? [] : names.split(","),
    render(name, model, rctx = CTX, timeoutMs = 50) {
      const lit = (s: string): string => JSON.stringify(s);
      const script =
        `(function () { var T = templates, P = JSON.parse;` +
        ` var r = T[P(${lit(JSON.stringify(name))})](P(${lit(JSON.stringify(model))}), P(${lit(JSON.stringify(rctx))}));` +
        ` if (typeof r !== "string") throw new TypeError("not a string: " + typeof r); return r; })()`;
      return new vm.Script(script).runInContext(ctx, { timeout: timeoutMs, displayErrors: false }) as string;
    },
  };
}
