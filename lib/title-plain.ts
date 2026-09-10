/** Strip noisy prefixes/suffixes from the terminal window title. */

import { basename } from "node:path";

type TitleCtx = {
  cwd?: string;
  getSessionName?: () => string | undefined;
  ui: { setTitle(title: string): void };
};

type ExtensionAPILike = {
  getSessionName?: () => string | undefined;
  on(event: string, handler: (...args: any[]) => void): void;
};

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function plainTitle(name: string | undefined, cwd: string | undefined): string {
  let t = String(name || "").replace(/[\r\n\t]+/g, " ").trim();
  t = t.replace(/^(π|pi)\s*[-–—:|]\s*/i, "");
  const base = cwd ? basename(cwd.replace(/\/+$/, "")) : "";
  if (base) t = t.replace(new RegExp(`\\s*[-–—]\\s*${escapeRe(base)}\\s*$`, "i"), "");
  t = t.replace(/\s*[-–—]\s*(ravenclaw|goose-agent|goose-note|goose-monitor|loopdesk|diteng[\w-]*)\s*$/i, "");
  return t.trim();
}

function apply(ctx: TitleCtx, name: string | undefined, pi: ExtensionAPILike): void {
  const raw = name ?? ctx.getSessionName?.() ?? pi.getSessionName?.();
  const title = plainTitle(raw, ctx.cwd);
  if (title) ctx.ui.setTitle(title);
}

/** Attach title-plain behavior. */
export default function attachTitlePlain(pi: ExtensionAPILike): void {
  let timer: ReturnType<typeof setInterval> | undefined;
  let lastCtx: TitleCtx | undefined;

  const start = (event: { name?: string } | undefined, ctx: TitleCtx) => {
    lastCtx = ctx;
    apply(ctx, event?.name ?? pi.getSessionName?.(), pi);
    if (timer) clearInterval(timer);
    timer = setInterval(() => {
      if (lastCtx) apply(lastCtx, pi.getSessionName?.(), pi);
    }, 400);
    timer.unref?.();
  };

  pi.on("session_start", start);
  pi.on("session_info_changed", start);
  pi.on("session_shutdown", () => {
    if (timer) clearInterval(timer);
    timer = undefined;
    lastCtx = undefined;
  });
}
