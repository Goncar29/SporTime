export interface AccountIdentity {
  /** False when the user must prove who they are before anything is touched. */
  isRecentlyConfirmed(): Promise<boolean>;
  /** Asks the user to prove who they are. A redirect may navigate away before settling. */
  confirm(): Promise<void>;
  /**
   * True once per accepted deletion, when the page loaded from a redirect in which the
   * provider re-confirmed this same account; the deletion should then continue by itself.
   */
  confirmedByRedirect(): Promise<boolean>;
  remove(): Promise<void>;
}

export interface AccountData {
  /**
   * Erases everything stored for the account, which also removes it from this
   * browser's cache. Safe to repeat after a partial failure.
   */
  erase(): Promise<void>;
}

/** "sent" means the server confirmed every change, not just this device's cache. */
export type SendResult = "sent" | "unsent";

/** What this device keeps for the signed-in account, apart from the server's copy. */
export interface LocalAccountData {
  /**
   * Sends every change still on this device, including one made while it waited for the server.
   * Never rejects; it reports "unsent" instead.
   */
  sendPending(): Promise<SendResult>;
  /** Drops the changes not yet sent, which are then lost. */
  discardPending(): void;
  /**
   * Erases the account's data from this device and leaves the device's own settings. Firestore
   * stops here, so the page must reload before anything reads or writes again.
   */
  erase(): Promise<void>;
}

/**
 * What the account's other open tabs are doing: one is signing out, which blocks this one, or it
 * signed out while a change made here was waiting, so that change could not be saved.
 */
export type OtherTabsStatus = "idle" | "signingOut" | "lostChange";

export interface OtherTabsActivity {
  get(): OtherTabsStatus;
  /** Calls `listener` when the status changes. Returns the unsubscribe function. */
  subscribe(listener: () => void): () => void;
}

/** Keeps the other tabs' changes waiting while this tab signs out. */
export interface OtherTabsGate {
  /**
   * Runs `work` once no change is being made in another tab, and holds new ones until it ends.
   * Null, without running it, when they did not finish in time. When forced, it then takes over
   * from them instead, and their changes are reported lost there if the account signs out.
   */
  holdOff<T>(work: () => Promise<T>, options?: { force?: boolean }): Promise<{ value: T } | null>;
  /** True while a change asked for in this tab waits for `work` to end. */
  changeWaitingHere(): boolean;
}
