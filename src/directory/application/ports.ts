/**
 * Whether the signed-in user can be found by their email, which they choose in Profile.
 * Writes apply on this device right away and reach the server when online.
 */
export interface DirectoryListing {
  /**
   * Reports whether this account is listed under its email, from this device's copy first,
   * then on every change. Returns the unsubscribe function.
   */
  subscribe(onListed: (listed: boolean) => void, onError: (error: unknown) => void): () => void;
  /** Lists the account's Google name and photo. Settles when the server answers. */
  list(): Promise<void>;
  /** Removes the account's entry. Settles when the server answers. */
  unlist(): Promise<void>;
}
