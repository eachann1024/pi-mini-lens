import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

type RGB = [number, number, number];
function ansiColor(ansi: string): RGB | undefined {
  const rgb = ansi.match(/(?:38|48);2;(\d+);(\d+);(\d+)/);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  const indexed = ansi.match(/(?:38|48);5;(\d+)/);
  if (!indexed) return;
  const n = Number(indexed[1]);
  if (n >= 232) return [8 + (n - 232) * 10, 8 + (n - 232) * 10, 8 + (n - 232) * 10];
  if (n >= 16) {
    const levels = [0, 95, 135, 175, 215, 255];
    return [levels[Math.floor((n - 16) / 36)], levels[Math.floor((n - 16) / 6) % 6], levels[(n - 16) % 6]];
  }
}

/** User gets the stronger accent surface; process gets its secondary tint. */
export function minimalSurface(theme: ExtensionContext["ui"]["theme"], text: string, user = false): string {
  const base = ansiColor(theme.getBgAnsi?.("userMessageBg") ?? "");
  const accent = ansiColor(theme.fg("accent", "")) ?? ansiColor(theme.fg("success", ""));
  if (!base || !accent) return theme.bg("userMessageBg", text);
  const weight = user ? 0.22 : 0.07;
  const rgb = base.map((value, i) => Math.round(value * (1 - weight) + accent[i] * weight));
  let prefix = `\x1b[48;2;${rgb.join(";")}m`;
  if (theme.getColorMode?.() === "256color") {
    const levels = [0, 95, 135, 175, 215, 255];
    const indices = rgb.map((value) => levels.reduce((best, level, i) => Math.abs(level - value) < Math.abs(levels[best] - value) ? i : best, 0));
    prefix = `\x1b[48;5;${16 + indices[0] * 36 + indices[1] * 6 + indices[2]}m`;
  }
  // Restore the surface after Markdown's inline reset sequences.
  return prefix + text.replace(/\x1b\[(?:0|49)?m/g, (reset) => reset + prefix) + "\x1b[49m";
}
