/**
 * The bundle's entry: every template weave renders by name (src/templates/<name>.ts), mapped to its function.
 *
 * The build bundles this file into dist/templates.js and ends it with `var templates = …`, which weave's loader
 * reads (ADR-0234 §3). A name here must match one of console-api.ts's template names (home, work, control,
 * machines, fleet, team, task, audit, factory) or be 'error'.
 */
import type { RenderCtx } from "../../contract/console-views-v1.js";
import { error } from "./error.js";

// `any`: the view model arrives as parsed JSON from weave; each template's own signature names its contract type.
export type Template = (vm: any, ctx: RenderCtx) => string;

export const templates: Readonly<Record<string, Template>> = { error };
