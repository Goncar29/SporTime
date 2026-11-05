import type { Messages } from "../../i18n/messages/types";
import type { Announcement } from "../domain/cues";

export function spokenPhrase(t: Messages, announcement: Announcement): string {
  switch (announcement.kind) {
    case "phase":
      return t.phases[announcement.phase];
    case "count":
      return String(announcement.seconds);
    case "tenSecondsLeft":
      return t.spokenTenSecondsLeft;
    case "halfway":
      return t.spokenHalfway;
    case "finish":
      return t.spokenFinish;
  }
}
