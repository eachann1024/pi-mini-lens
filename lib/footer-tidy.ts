/** Hide noisy footer statuses (LSP / @build / sandbox / write path, etc.). */

type FooterData = {
  getExtensionStatuses(): Iterable<[string, string]>;
};

type StatusUi = {
  setStatus(key: string, text: string | undefined): void;
  setFooter(factory: ((tui: unknown, theme: unknown, footerData: FooterData) => { render: () => string[] }) | undefined): void;
};

type ExtensionCtx = {
  ui: StatusUi;
};

type ExtensionAPILike = {
  on(event: string, handler: (...args: any[]) => void): void;
};

function stripAnsi(text: string): string {
  return String(text || "").replace(/\x1b\[[0-9;]*m/g, "");
}

function tidyText(text: string): string {
  return stripAnsi(text)
    .replace(/[\r\n\t]/g, " ")
    .replace(/^[ \t·•|●○]+/g, "")
    .replace(/[ \t·•|●○]+$/g, "")
    .replace(/ +/g, " ")
    .trim();
}

function hideStatus(key: string, text: string): boolean {
  const k = String(key || "").toLowerCase();
  const v = String(text || "").toLowerCase();
  if (k === "pi-lens-lsp" || k.includes("lsp")) return true;
  if (k === "@build" || k === "build" || k.includes("@build")) return true;
  if (k.includes("sandbox")) return true;
  if (v.includes("lsp")) return true;
  if (v.includes("@build")) return true;
  if (v.includes("sandbox")) return true;
  if (v.includes("unrestricted")) return true;
  if (v.includes("write path")) return true;
  if (!tidyText(text)) return true;
  return false;
}

function wrapSetStatus(ctx: ExtensionCtx): StatusUi["setStatus"] {
  const orig = ctx.ui.setStatus.bind(ctx.ui);
  ctx.ui.setStatus = (key: string, text: string | undefined) => {
    if (text === undefined || hideStatus(key, text)) {
      orig(key, undefined);
      return;
    }
    const visible = stripAnsi(text).replace(/[\r\n\t]/g, " ");
    if (/^[ \t·•|●○]+/.test(visible) || /[ \t·•|●○]+$/.test(visible)) {
      orig(key, tidyText(text) || undefined);
      return;
    }
    orig(key, text);
  };
  return orig;
}

function sweep(origSet: StatusUi["setStatus"], footerData: FooterData): void {
  for (const [key, text] of footerData.getExtensionStatuses()) {
    if (hideStatus(key, text)) {
      origSet(key, undefined);
      continue;
    }
    const visible = stripAnsi(text).replace(/[\r\n\t]/g, " ");
    if (/^[ \t·•|●○]+/.test(visible) || /[ \t·•|●○]+$/.test(visible)) {
      origSet(key, tidyText(text) || undefined);
    }
  }
  origSet("pi-lens-lsp", undefined);
  origSet("@build", undefined);
  origSet("build", undefined);
  origSet("sandbox", undefined);
}

/** Attach footer-tidy behavior. Register before the main footer so the first capture runs first. */
export default function attachFooterTidy(pi: ExtensionAPILike): void {
  let timer: ReturnType<typeof setInterval> | undefined;
  let captured: FooterData | undefined;
  let capturing = false;

  const grabFooterData = (ctx: ExtensionCtx) => {
    if (capturing || captured) return;
    capturing = true;
    ctx.ui.setFooter((_tui, _theme, footerData) => {
      captured = footerData;
      queueMicrotask(() => {
        ctx.ui.setFooter(undefined);
        capturing = false;
      });
      return { render: () => [] };
    });
  };

  const start = (_event: unknown, ctx: ExtensionCtx) => {
    const origSet = wrapSetStatus(ctx);
    grabFooterData(ctx);
    if (timer) clearInterval(timer);
    timer = setInterval(() => {
      origSet("pi-lens-lsp", undefined);
      origSet("@build", undefined);
      origSet("build", undefined);
      origSet("sandbox", undefined);
      if (captured) sweep(origSet, captured);
      else grabFooterData(ctx);
    }, 250);
    timer.unref?.();
  };

  pi.on("session_start", start);
  pi.on("session_shutdown", () => {
    if (timer) clearInterval(timer);
    timer = undefined;
    captured = undefined;
  });
}
