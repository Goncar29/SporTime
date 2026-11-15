import type { LocalAccountData } from "./ports";

export type SignOutResult = "signedOut" | "unsent";

export interface SignOutOptions {
  /** Signs out even with changes that could not be sent, which are then lost. */
  force?: boolean;
}

interface Dependencies {
  auth: { signOut(): Promise<void> };
  local: LocalAccountData;
}

/**
 * The order matters. Sending comes before signing out because Firestore stops waiting for the
 * server once the user changes. Erasing comes after, so a refused sign-out never leaves a live
 * session with no local data; "signedOut" tells the caller to reload for a fresh Firestore.
 * Once signed out it stays "signedOut" even if erasing fails: the session is gone either way,
 * and the cache keeps its own note to clear itself on the next start.
 * Signing out follows the send with nothing in between, so no change can slip past it; when
 * forced, the changes are dropped only once the provider signed out, so a refusal keeps them.
 */
export async function signOut(
  { auth, local }: Dependencies,
  { force = false }: SignOutOptions = {},
): Promise<SignOutResult> {
  if (!force && (await local.sendPending()) === "unsent") return "unsent";
  await auth.signOut();
  if (force) local.discardPending();
  try {
    await local.erase();
  } catch (error) {
    console.warn("This device's copy of the account was not fully erased:", error);
  }
  return "signedOut";
}
