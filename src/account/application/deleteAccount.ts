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
  await identity.remove();
  await data.clearDevice().catch((error: unknown) => {
    // The account is already gone, so this must not read as a failed deletion.
    console.error("This browser's copy could not be cleared:", error);
  });
}
