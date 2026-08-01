/**
 * Collaborative-approval primitives (reusable across stages — wired into Spec
 * craft first). A "unit" is anything a team co-approves; today that's a spec
 * component/section. These types are framework-agnostic (no React, no DB) so the
 * same shapes back the mock now and a real store later.
 */

/** The minimal identity needed to render and resolve a teammate. */
export interface MemberRef {
  id: string;
  displayName: string;
  /** Hex seed for the avatar tint chip. */
  avatarTint: string;
}

/**
 * A person attached to a unit for collaborative approval. `approvedAt !== null`
 * means they have nodded. The responsible set for a unit is its participant
 * list (author + everyone @-mentioned in).
 */
export interface Participant {
  member: MemberRef;
  /** ISO timestamp of their approval, or null when still pending. */
  approvedAt: string | null;
}

/**
 * A turn in a unit's collaborative discussion — the "group chat" that emerges
 * once a second participant joins. Distinct from the Forge Q&A interview; this
 * is teammate-to-teammate.
 */
export interface DiscussionMsg {
  id: string;
  /** Author member id, or the `'forge'` sentinel for an AI turn. */
  authorId: string;
  /** Message text. If it @-mentions teammates, those names are in the body and
   *  the AI does not answer that turn — the mentioned people reply instead. */
  body: string;
  /** True when this turn also recorded the author's approval. */
  approval?: boolean;
}

/** The collaborative state attached to one co-approved unit (a spec component). */
export interface UnitCollab {
  participants: Participant[];
  discussion: DiscussionMsg[];
}
