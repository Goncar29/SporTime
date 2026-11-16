import type { LocalAccountData, OtherTabsGate } from "./ports";

export type SignOutResult = "signedOut" | "unsent";

export interface SignOutOptions {
  /** Signs out even with changes that could not be sent, which are then lost. */
  force?: boolean;
}

interface Dependencies {
  auth: { signOut(): Promise<void> };
  local: LocalAccountData;
  /** The account's other open tabs; without them nothing waits. */
  otherTabs?: OtherTabsGate;
}

/**
 * The order matters. Sending comes before signing out because Firestore stops waiting for the
 * server once the user changes. Erasing comes after, so a refused sign-out never leaves a live
 * session with no local data; "signedOut" tells the caller to reload for a fresh Firestore.
 * Once signed out it stays "signedOut" even if erasing fails: the session is gone either way,
 * and the cache keeps its own note to clear itself on the next start.
 * Signing out follows the send with nothing in between, so no change can slip past it; when
 * forced, the changes are dropped only once the provider signed out, so a refusal keeps them.
 * The account's other tabs share what this one sends and erases, so their changes wait from the
 * send until erasing ends. If one of theirs does not finish in time, it is not sent: "unsent",
 * unless forced, which signs out anyway, as the user chose to lose what was not sent.
 */
export async function signOut(
  { auth, local, otherTabs }: Dependencies,
  options: SignOutOptions = {},
): Promise<SignOutResult> {
  const run = () => signOutHere({ auth, local }, options);
  if (!otherTabs) return run();
  const held = await otherTabs.holdOff(run);
  if (held) return held.value;
  return options.force ? run() : "unsent";
}

async function signOutHere(
  { auth, local }: Omit<Dependencies, "otherTabs">,
  { force = false }: SignOutOptions,
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
