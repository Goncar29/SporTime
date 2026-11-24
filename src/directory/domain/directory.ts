/**
 * The directory lets a signed-in user find another one by exact email, and only those who chose
 * to be found. Each entry is stored at `directory/{normalized email}`. Limits mirror the rules for
 * `directory/{email}` in firestore/firestore.rules; firestore/rules.test.ts keeps them in step.
 */
export const DIRECTORY_LIMITS = { nameLength: 100, photoLength: 500 } as const;

/** What anyone signed in may read about a user who chose to be found by email. */
export interface DirectoryEntry {
  uid: string;
  /** Google's display name, or empty when Google gave none. */
  name: string;
  /** An https photo on googleusercontent.com, or empty. */
  photo: string;
}

/** One address, one entry: spaces around it and letter case do not make another one. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Only Google's own photo host, with nothing but the host before the path, so neither credentials
 * nor a port nor a look-alike host can pass. The same pattern is in the rules.
 */
const GOOGLE_PHOTO = /^https:\/\/([a-z0-9-]+\.)*googleusercontent\.com\/[^\p{Cc}\p{Z}]*$/u;

export function isGooglePhoto(url: string): boolean {
  return url.length <= DIRECTORY_LIMITS.photoLength && GOOGLE_PHOTO.test(url);
}

/** Cuts by whole characters, so a character outside the basic plane is never split in half. */
function limitLength(text: string, max: number): string {
  let kept = "";
  for (const character of text) {
    if (kept.length + character.length > max) break;
    kept += character;
  }
  return kept;
}

function displayName(name: string, email: string): string {
  // Firestore refuses half of a broken character (a lone surrogate) for ever.
  const line = name
    .replace(/\p{Cs}/gu, "")
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  // The app shows the email when Google gave no name; the entry's id already is the email.
  if (normalizeEmail(line) === normalizeEmail(email)) return "";
  return limitLength(line, DIRECTORY_LIMITS.nameLength).trim();
}

export function directoryEntryFor(user: {
  id: string;
  name: string;
  email: string;
  photoUrl: string | null;
}): DirectoryEntry {
  return {
    uid: user.id,
    name: displayName(user.name, user.email),
    photo: user.photoUrl !== null && isGooglePhoto(user.photoUrl) ? user.photoUrl : "",
  };
}
