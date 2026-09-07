import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, type Component } from "@earendil-works/pi-tui";

type Theme = ExtensionContext["ui"]["theme"];
export interface AgentCall {
  id: string;
  name: string;
  task: string;
  state: "running" | "done" | "error";
  output?: string;
}
export const isAgentTool = (name: string) => /^(subagent|agents?|get_subagent_result|steer_subagent|bg_wait)$/i.test(name);
export function agentCall(id: string, tool: string, args: unknown): AgentCall {
  const data = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  const name = String(data.agent ?? data.subagent_type ?? data.agent_type ?? tool);
  return { id, name, task: String(data.task ?? data.prompt ?? data.description ?? data.action ?? data.command ?? data.path ?? ""), state: "running" };
}
export function agentCallRows(calls: AgentCall[], theme: Theme, width: number, expanded: boolean,
  markdown: (text: string, width: number) => string[]): string[] {
  if (!calls.length || width < 1) return [];
  const running = calls.filter(call => call.state === "running").length;
  const errors = calls.filter(call => call.state === "error").length;
  const done = calls.length - running - errors;
  const header = `${expanded ? "⌄" : "›"} Agent 调用 · ${calls.length} 个 · ${running} 执行中 · ${done} 已返回${errors ? ` · ${errors} 失败` : ""} · Ctrl+O`;
  const rows = [truncateToWidth(theme.fg(errors ? "error" : running ? "accent" : "muted", header), width)];
  if (expanded) calls.forEach((call, index) => {
    const color = call.state === "error" ? "error" : call.state === "done" ? "success" : "accent";
    const glyph = call.state === "error" ? "✗" : call.state === "done" ? "✓" : "●";
    rows.push(truncateToWidth(theme.fg(color, `${index === calls.length - 1 ? "└─" : "├─"} ${glyph} ${call.name}`), width));
    for (const text of [call.task, call.output]) {
      if (text) rows.push(...markdown(text, Math.max(1, width - 3)).map(row => truncateToWidth(`   ${row}`, width, "")));
    }
  });
  return rows;
}

const plain = (text: string) => text.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").trim();
/** Presentation adapter for pi-subagents' independently updated widget.
 * Unknown widget formats pass through unchanged; no task state is inferred.
 */
export function restyleAgentWidget(lines: string[], theme: Theme, width: number, expanded: boolean): string[] {
  const content = lines.map(plain).filter(Boolean);
  if (!content.length || !/^(?:[●○◉⠋-⣿]\s*)?(?:async subagent|Async agents)\b/i.test(content[0])) return lines;
  const details = content.slice(1);
  const states = details.filter(line => /\b(running|queued|complete|completed|failed|paused|stopped|done|error)\b/i.test(line));
  const error = states.some(line => /\b(failed|error)\b/i.test(line));
  const active = states.some(line => /\b(running|queued)\b/i.test(line));
  const summary = states[0] ?? content[0].replace(/async subagent|Async agents/i, "").trim();
  const header = theme.fg(error ? "error" : active ? "accent" : "muted", `${expanded ? "⌄" : "›"} 后台 Agents · ${summary} · Ctrl+O`);
  if (!expanded) return [truncateToWidth(header, width)];
  return [truncateToWidth(theme.fg("accent", "⌄ 后台 Agents · Ctrl+O 收起"), width), ...details.map((line, index) => {
    const color = /\b(failed|error)\b/i.test(line) ? "error" : /\b(running|queued)\b/i.test(line) ? "accent" : "muted";
    return truncateToWidth(theme.fg(color, `${index === details.length - 1 ? "└─" : "├─"} ${line}`), width);
  })];
}

/** Pi 0.85 widget containers: preserve unrelated widgets and their lifecycle. */
export function attachAgentWidgets(tui: unknown, theme: Theme, expanded: () => boolean): () => void {
  const host = tui as { children?: Array<Component & { children?: Component[] }> };
  if (host.children?.length !== 7) return () => {};
  const restores: Array<() => void> = [];
  for (const index of [3, 5]) {
    const container = host.children[index];
    if (!Array.isArray(container?.children)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(container, "render");
    const mouseDescriptor = Object.getOwnPropertyDescriptor(container, "handleMouse");
    const render = (width: number) => container.children!.flatMap(child => restyleAgentWidget(child.render(width), theme, width, expanded()));
    const mouse: NonNullable<Component["handleMouse"]> = (event) => {
      let y = 0;
      for (const child of container.children!) {
        const original = child.render(event.width);
        const shown = restyleAgentWidget(original, theme, event.width, expanded());
        if (event.y >= y && event.y < y + shown.length) {
          // Do not route clicks into native controls hidden by the compact view.
          return shown === original ? child.handleMouse?.({ ...event, y: event.y - y, height: shown.length }) : undefined;
        }
        y += shown.length;
      }
    };
    container.render = render;
    container.handleMouse = mouse;
    restores.push(() => {
      if (container.handleMouse === mouse) {
        if (mouseDescriptor) Object.defineProperty(container, "handleMouse", mouseDescriptor);
        else delete container.handleMouse;
      }
      if (container.render !== render) return;
      if (descriptor) Object.defineProperty(container, "render", descriptor);
      else delete (container as Partial<Component>).render;
    });
  }
  return () => restores.forEach(restore => restore());
}
