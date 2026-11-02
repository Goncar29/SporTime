import type { Language } from "../domain/language";
import { en } from "./en";
import { es } from "./es";
import type { Messages } from "./types";

export const MESSAGES: Record<Language, Messages> = { en, es };
