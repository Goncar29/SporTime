import type { InstallState } from "../domain/install";

export type { InstallState };

export interface InstallController {
  state: () => InstallState;
  /** Called whenever the state changes; returns a function that stops listening. */
  subscribe: (listener: () => void) => () => void;
  /** Opens the browser's install dialog when there is one. */
  install: () => Promise<"accepted" | "dismissed" | "unavailable">;
}

/** When the user last chose "Not now", kept on this device only. */
export interface InstallDismissals {
  get: () => number | null;
  set: (at: number) => void;
}
