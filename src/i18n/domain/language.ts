export const LANGUAGES = ["en", "es"] as const;

export type Language = (typeof LANGUAGES)[number];

const DEFAULT_LANGUAGE: Language = "en";

const isLanguage = (value: string | null): value is Language =>
  LANGUAGES.includes(value as Language);

/** A stored choice wins, then the first supported browser language, ignoring its region. */
export function resolveLanguage(
  stored: string | null,
  browserLanguages: readonly string[],
): Language {
  if (isLanguage(stored)) return stored;
  for (const tag of browserLanguages) {
    const primary = tag.split("-")[0]?.toLowerCase() ?? null;
    if (isLanguage(primary)) return primary;
  }
  return DEFAULT_LANGUAGE;
}
