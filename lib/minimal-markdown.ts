import { Marked } from "@earendil-works/pi-tui";
import { render } from "grok-mermaid";

const parser = new Marked();
/** Keep incomplete, unsupported and over-wide diagrams readable as source. */
export function diagramMarkdown(source: string, width: number): string {
  return parser.lexer(source).map((token) => {
    if (token.type !== "code" || token.lang?.trim().toLowerCase() !== "mermaid") return token.raw;
    const art = render(token.text);
    if (!art || art.width > width || art.warnings.length) return token.raw;
    return art.plain.map((line) => {
      const content = line || "\u00a0";
      const fence = "`".repeat(Math.max(0, ...Array.from(content.matchAll(/`+/g), (match) => match[0].length)) + 1);
      return `${fence} ${content} ${fence}`;
    }).join("  \n") + "\n\n";
  }).join("");
}
