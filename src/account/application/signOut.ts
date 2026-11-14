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
 */
export async function signOut(
  { auth, local }: Dependencies,
  { force = false }: SignOutOptions = {},
): Promise<SignOutResult> {
  if (force) local.discardPending();
  else if ((await local.sendPending()) === "unsent") return "unsent";
  await auth.signOut();
  await local.erase();
  return "signedOut";
}
