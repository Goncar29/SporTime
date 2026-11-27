import { ContactAvatar } from "../../contacts/ui/ContactAvatar";
import { isolate } from "../../i18n/messages/isolate";
import { useI18n } from "../../i18n/ui/I18nProvider";
import { senderName, type Sender } from "../domain/routine";
import styles from "./ReceivedFrom.module.css";

interface ReceivedFromProps {
  sender: Sender;
  /** The id of the line's text, which describes the routine it belongs to. */
  id?: string;
  className?: string;
}

/**
 * "Received from <name> (<email>)" for a routine a contact sent (S12), after their Google photo,
 * or the initial of their name (else their email) when there is none or it is not on
 * googleusercontent.com (T29 W3). The name and photo are the sender's own choice, which may say
 * anything, even be empty or hold bidi controls; only the verified email tells who they are, so it
 * is always shown. Both are isolated, and so is the whole line. The photo is decoration: the text
 * says who it is.
 */
export function ReceivedFrom({ sender, id, className }: ReceivedFromProps) {
  const { t } = useI18n();
  const name = senderName(sender);
  return (
    <span className={className === undefined ? styles.line : `${styles.line} ${className}`}>
      <ContactAvatar
        className={styles.avatar}
        contact={{
          uid: sender.uid,
          name: sender.name,
          email: sender.email,
          photo: sender.photo ?? "",
        }}
      />
      <bdi id={id}>
        {t.receivedFrom(name === null ? null : isolate(name), isolate(sender.email))}
      </bdi>
    </span>
  );
}
