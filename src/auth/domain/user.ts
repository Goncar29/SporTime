export interface User {
  id: string;
  name: string;
  email: string;
  photoUrl: string | null;
}

export type AuthFailureKind = "cancelled" | "network" | "staleSignIn" | "wrongAccount" | "unknown";

export class AuthFailure extends Error {
  constructor(readonly kind: AuthFailureKind) {
    super(`Sign-in failed: ${kind}`);
    this.name = "AuthFailure";
  }
}

export function initialsOf(name: string, email: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0];
  const last = words.length > 1 ? words.at(-1)?.[0] : undefined;
  const letters = first ? `${first}${last ?? ""}` : (email.trim()[0] ?? "?");
  return letters.toUpperCase();
}
