/**
 * A transition's PAYLOAD was invalid — the action kind is real and permitted, but the
 * `data` it carried is not usable (an unknown component kind, an over-long brief).
 *
 * Distinct from `TransitionRejected`, which means "the gate says not now" and tells the
 * driver to WAIT and re-resolve. Waiting on a bad payload would spin forever, so this is
 * a terminal error: the route answers 400 with `message`, and the auto driver treats it
 * as a real failure and stops.
 *
 * Lives in its own module because `details-actions` throws it and `perform-transition`
 * imports `details-actions` — declaring it beside `TransitionRejected` would close an
 * import cycle.
 */
export class InvalidActionInput extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidActionInput';
  }
}
