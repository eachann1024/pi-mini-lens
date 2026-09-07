import type { Component } from "@earendil-works/pi-tui";

interface ContainerLike extends Component { children: Component[] }
function isContainer(value: unknown): value is ContainerLike {
  const node = value as Partial<ContainerLike> | null;
  return !!node && Array.isArray(node.children) && typeof node.render === "function" && typeof node.invalidate === "function";
}

/** Pi 0.85.x private layout adapter. Never mutates the stored messages or child tree. */
export function attachTranscript(tui: unknown, view: Component): (() => void) | undefined {
  const host = tui as { children?: unknown[] };
  // Both regular and fullscreen retain this seven-container tree. Fullscreen's
  // ScrollView renders the same document instance. Fail closed on unknown layouts.
  if (!Array.isArray(host.children) || host.children.length !== 7 || !host.children.every(isContainer)) return;
  const document = host.children[0] as ContainerLike;
  if (document.children.length !== 3 || !document.children.every(isContainer)) return;
  const [header, resources, chat] = document.children as ContainerLike[];
  // During /reload Pi replaces the editor with a reload notice until AFTER
  // session_start. The validated document/container layout remains unchanged.
  // Custom editors also need not expose getText; do not use editor contents
  // as a transcript identity check.
  const renderDescriptor = Object.getOwnPropertyDescriptor(document, "render");
  const mouseDescriptor = Object.getOwnPropertyDescriptor(document, "handleMouse");
  const originalRender = document.render;
  const originalMouse = document.handleMouse;
  const render: Component["render"] = (width) => [
    ...header.render(width), ...resources.render(width), ...view.render(width),
    // Preserve native notices/errors, which do not arrive as agent messages.
    ...chat.children.filter((child) => child.constructor.name === "Text").flatMap((child) => child.render(width)),
  ];
  // Do not dispatch pointer events into invisible native message components.
  // Unhandled events still reach the parent ScrollView / selection machinery.
  const mouse: NonNullable<Component["handleMouse"]> = () => undefined;
  document.render = render;
  document.handleMouse = mouse;
  return () => {
    if (document.render === render) {
      if (renderDescriptor) Object.defineProperty(document, "render", renderDescriptor);
      else { delete (document as Partial<Component>).render; if (document.render !== originalRender) document.render = originalRender; }
    }
    if (document.handleMouse === mouse) {
      if (mouseDescriptor) Object.defineProperty(document, "handleMouse", mouseDescriptor);
      else { delete document.handleMouse; if (document.handleMouse !== originalMouse) document.handleMouse = originalMouse; }
    }
  };
}
