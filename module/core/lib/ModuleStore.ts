import { fromFileUrl } from "@std/path";
import type { ModuleManager } from "./ModuleManager.ts";

export abstract class ModuleStore {
  abstract importAll(manager: ModuleManager): Promise<void>;
}

export class ModuleStoreFolder extends ModuleStore {
  readonly path: string;

  constructor(path: string) {
    super();
    this.path = path.startsWith("file:") ? fromFileUrl(path) : path;
  }

  async importAll(manager: ModuleManager): Promise<void> {
    await manager.importAll(this.path);
  }
}
