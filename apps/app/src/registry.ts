/**
 * Tool-Registry. Eine Sammlung aller Tools, über die der Router iteriert — auch
 * der Mandantentrennungs-Test iteriert über sie, damit ein neu hinzugefügtes Tool
 * automatisch mitgeprüft wird ([docs/08], [docs/10]).
 */

import type { AnyTool } from "./tool.ts";

export class ToolRegistry {
  readonly #tools = new Map<string, AnyTool>();

  register(tool: AnyTool): this {
    if (this.#tools.has(tool.name)) {
      throw new Error(`Tool doppelt registriert: ${tool.name}`);
    }
    this.#tools.set(tool.name, tool);
    return this;
  }

  get(name: string): AnyTool | undefined {
    return this.#tools.get(name);
  }

  list(): readonly AnyTool[] {
    return [...this.#tools.values()];
  }

  get size(): number {
    return this.#tools.size;
  }
}
