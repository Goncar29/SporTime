import type { Language } from "../domain/language";

export interface LanguageStore {
  get(): string | null;
  set(language: Language): void;
}
