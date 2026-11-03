import { AuthFailure } from "../../auth/domain/user";
import type { AccountData, AccountIdentity } from "./ports";

interface Dependencies {
  identity: AccountIdentity;
  data: AccountData;
}

/**
 * The order matters. Identity comes first because a refused removal after erasing
 * would leave a live account with no data; data comes before the account because
 * the security rules stop accepting anything once the account is gone.
 */
export async function deleteAccount({ identity, data }: Dependencies): Promise<void> {
  if (!(await identity.isRecentlyConfirmed())) await identity.confirm();
  await data.erase();
  try {
    await identity.remove();
  } catch (error) {
    if (!(error instanceof AuthFailure) || error.kind !== "staleSignIn") throw error;
    // Only the provider's own clock can settle this, so it may still refuse here.
    await identity.confirm();
    await identity.remove();
  }
}
