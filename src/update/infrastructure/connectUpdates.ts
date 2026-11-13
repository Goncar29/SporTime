import type { RegisterSWOptions } from "vite-plugin-pwa/types";
import { createAppUpdater, type AppUpdater } from "../application/appUpdater";

/** vite-plugin-pwa's registerSW: registers the worker and returns the switch to a waiting one. */
export type UpdateRegistration = (options: RegisterSWOptions) => () => Promise<void>;

interface ConnectUpdatesOptions {
  register: UpdateRegistration;
  /** navigator.serviceWorker */
  container: EventTarget & { controller: object | null };
  reload: () => void;
  onRegistered?: RegisterSWOptions["onRegisteredSW"];
}

/**
 * Applies each new version of the app when no workout is running. A version can arrive
 * two ways: this page's worker finds it waiting, or another open tab already switched to
 * it, which leaves this page running old code under the new worker until it reloads.
 */
export function connectUpdates({
  register,
  container,
  reload,
  onRegistered,
}: ConnectUpdatesOptions): AppUpdater {
  let reloading = false;
  const reloadOnce = () => {
    if (reloading) return;
    reloading = true;
    reload();
  };

  let controlled = container.controller !== null;
  let applying = false;
  let alreadySwitched = false;
  let switchToWaiting: () => Promise<void> = () => Promise.resolve();

  const updater = createAppUpdater(() => {
    if (alreadySwitched) {
      reloadOnce();
      return;
    }
    applying = true;
    void switchToWaiting();
  });

  container.addEventListener("controllerchange", () => {
    // The first worker taking over a first visit is not a new version.
    if (!controlled) {
      controlled = true;
      return;
    }
    if (applying) {
      reloadOnce();
      return;
    }
    alreadySwitched = true;
    updater.ready();
  });

  switchToWaiting = register({
    onNeedRefresh: () => {
      updater.ready();
    },
    // workbox-window's own reload signal, for a switch this page made.
    onNeedReload: () => {
      if (applying) reloadOnce();
    },
    onRegisteredSW: onRegistered,
  });

  return updater;
}
