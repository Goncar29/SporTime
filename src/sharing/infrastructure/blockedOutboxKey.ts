/** Where this device holds an account's blocks until Firestore's cache has them (T27). */
export const blockedOutboxKey = (userId: string) => `sportime.outbox.blocked.${userId}`;
