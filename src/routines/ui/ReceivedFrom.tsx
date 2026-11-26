import { isolate } from "../../i18n/messages/isolate";
import { useI18n } from "../../i18n/ui/I18nProvider";
import { senderName, type Sender } from "../domain/routine";

interface ReceivedFromProps {
  sender: Sender;
  id?: string;
  className?: string;
}

/**
 * "Received from <name> (<email>)" for a routine a contact sent (S12). The name is the sender's
 * own text, which may say anything, even be empty or hold bidi controls; only the verified email
 * tells who they are, so it is always shown. Both are isolated, and so is the whole line.
 */
export function ReceivedFrom({ sender, id, className }: ReceivedFromProps) {
  const { t } = useI18n();
  const name = senderName(sender);
  return (
    <bdi id={id} className={className}>
      {t.receivedFrom(name === null ? null : isolate(name), isolate(sender.email))}
    </bdi>
  );
}
