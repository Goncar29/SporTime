import { AuthFailure, type AuthFailureKind } from "../../auth/domain/user";
import type { AccountData, AccountIdentity, OtherTabsGate } from "./ports";

/** Answers that prove the account is still there, now that its data is already gone. */
const UNFINISHED: readonly AuthFailureKind[] = ["cancelled", "wrongAccount", "staleSignIn"];

interface Dependencies {
  identity: AccountIdentity;
  data: AccountData;
  /** The account's other tabs; without them nothing waits. */
  otherTabs?: OtherTabsGate;
}

/**
 * The order matters. Identity comes first because a refused removal after erasing
 * would leave a live account with no data; data comes before the account because
 * the security rules stop accepting anything once the account is gone.
 * A change stored between erasing and removing would stay on the server for ever, out of
 * anyone's reach, so every change waits, here and in the account's other tabs, from erasing
 * until the account is gone, and is then refused. If one already under way does not finish in
 * time, nothing is touched; the provider's own confirmation comes first, as it may navigate away.
 */
export async function deleteAccount({ identity, data, otherTabs }: Dependencies): Promise<void> {
  if (!(await identity.isRecentlyConfirmed())) await identity.confirm();
  const run = () => eraseThenRemove({ identity, data });
  if (!otherTabs) {
    await run();
    return;
  }
  // Nothing was erased, so the generic message, which asks to try again, holds.
  if (!(await otherTabs.holdOff(run))) throw new AuthFailure("unknown");
}

async function eraseThenRemove({ identity, data }: Dependencies): Promise<void> {
  await data.erase();
  try {
    await identity.remove();
  } catch (error) {
    if (!(error instanceof AuthFailure) || error.kind !== "staleSignIn") throw error;
    // Only the provider's own clock can settle this, so it may still refuse here.
    try {
      await identity.confirm();
      await identity.remove();
    } catch (refusal) {
      if (refusal instanceof AuthFailure && UNFINISHED.includes(refusal.kind)) {
        throw new AuthFailure("dataErased");
      }
      throw refusal;
    }
  }
}
