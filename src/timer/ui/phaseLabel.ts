import type { Messages } from "../../i18n/messages/types";
import type { PhaseKind } from "../../workouts/domain/timeline";

/** A round's own name when it has one, otherwise the phase's default name. */
export function phaseLabel(t: Messages, phase: { kind: PhaseKind; name?: string }): string {
  return phase.name ?? t.phases[phase.kind];
}
