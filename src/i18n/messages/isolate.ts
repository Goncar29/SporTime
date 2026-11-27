/**
 * Every bidi control: embeddings and overrides (U+202A-U+202E), isolates (U+2066-U+2069) and the
 * marks (U+200E, U+200F, U+061C). Inside isolated text none is needed, and a stray U+2069 there
 * would end the isolate early and let what follows reorder the message around it.
 */
const BIDI_CONTROLS = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;

/**
 * Wraps text in first-strong isolates (U+2068 … U+2069), so a name written right to left, or one
 * holding bidi controls, cannot reorder the words of the message around it. Its own bidi controls
 * are removed first, so none can escape the isolate (L64 B1). For plain strings such as accessible
 * names, dialog titles and messages; text rendered as markup uses `<bdi>` instead.
 */
export const isolate = (text: string) => `\u2068${text.replace(BIDI_CONTROLS, "")}\u2069`;
