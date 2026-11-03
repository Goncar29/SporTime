export interface AccountIdentity {
  /** True only when the provider will surely accept removing the account right now. */
  isRecentlyConfirmed(): Promise<boolean>;
  /** Asks the user to prove who they are. A redirect may navigate away before settling. */
  confirm(): Promise<void>;
  remove(): Promise<void>;
}

export interface AccountData {
  /**
   * Erases everything stored for the account, which also removes it from this
   * browser's cache. Safe to repeat after a partial failure.
   */
  erase(): Promise<void>;
}
