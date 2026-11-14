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
  /** Sends every change still on this device. Never rejects; it reports "unsent" instead. */
  sendPending(): Promise<SendResult>;
  /** Drops the changes not yet sent, which are then lost. */
  discardPending(): void;
  /**
   * Erases the account's data from this device and leaves the device's own settings. Firestore
   * stops here, so the page must reload before anything reads or writes again.
   */
  erase(): Promise<void>;
}
