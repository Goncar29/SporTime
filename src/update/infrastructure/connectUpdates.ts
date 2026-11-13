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
  let busy = false;
  // Set once this page asks the waiting worker to take over; the takeover may never come.
  let applying = false;
  let alreadySwitched = false;
  let switchToWaiting: () => Promise<void> = () => Promise.resolve();

  const inner = createAppUpdater(() => {
    if (alreadySwitched) {
      reloadOnce();
      return;
    }
    applying = true;
    void switchToWaiting();
  });

  container.addEventListener("controllerchange", () => {
    const firstTakeover = !controlled;
    controlled = true;
    // The switch this page asked for, made while free: show the new version now.
    if (applying && !busy) {
      reloadOnce();
      return;
    }
    // The first worker taking over a first visit is not a new version.
    if (firstTakeover && !applying) return;
    // Another tab switched, or a late switch arrived during a workout: reload once free.
    alreadySwitched = true;
    inner.ready();
  });

  switchToWaiting = register({
    onNeedRefresh: () => {
      inner.ready();
    },
    // workbox-window's own reload signal, for a switch this page made.
    onNeedReload: () => {
      if (applying && !busy) reloadOnce();
    },
    onRegisteredSW: onRegistered,
  });

  return {
    ready: inner.ready,
    setBusy(next) {
      busy = next;
      inner.setBusy(next);
    },
  };
}
