import { useState } from "react";
import { isGooglePhoto } from "../../directory/domain/directory";
import type { Contact } from "../domain/contact";

/** The name shown for a contact: Google's, or the email they were added by when there is none. */
export const shownName = ({ name, email }: Contact) => name || email;

/** The shared isolation, which also removes the name's own bidi controls (L64 B1). */
export { isolate } from "../../i18n/messages/isolate";

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/** The first letter or digit of the name, else of the email; bidi controls and marks are skipped. */
function initialOf({ name, email }: Contact): string {
  const first = LETTER_OR_DIGIT.exec(name)?.[0] ?? LETTER_OR_DIGIT.exec(email)?.[0] ?? "?";
  return first.toLocaleUpperCase();
}

/** Google's photo when there is one and it loads, otherwise the initial; the name sits beside it. */
export function ContactAvatar({ contact, className }: { contact: Contact; className?: string }) {
  const [photoFailed, setPhotoFailed] = useState(false);
  if (contact.photo && isGooglePhoto(contact.photo) && !photoFailed) {
    return (
      <img
        className={className}
        src={contact.photo}
        alt=""
        // Google's image host rejects some referrers, and it does not need to know this app.
        referrerPolicy="no-referrer"
        onError={() => {
          setPhotoFailed(true);
        }}
      />
    );
  }
  return (
    <span className={className} aria-hidden="true">
      {initialOf(contact)}
    </span>
  );
}
