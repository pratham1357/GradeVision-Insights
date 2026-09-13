/**
 * The product-level contract for process evidence, stated once so the student
 * notice, the instructor view and the documentation cannot drift apart.
 *
 * This describes what the implementation actually does. It deliberately makes
 * no legal or compliance claim, and it does not claim automated deletion the
 * code cannot perform (see `notEnforced`).
 */
export const EVIDENCE_POLICY_VERSION = 1;

export interface EvidencePolicy {
  version: number;
  /** Evidence recorded for an assessment session, by the student's own actions. */
  collected: string[];
  /** Explicitly never recorded. */
  notCollected: string[];
  /** How the record is associated. */
  association: string;
  /** Who can read what. */
  access: string[];
  /** Intended retention - a policy statement, not an automated mechanism. */
  retention: string[];
  /** What the current implementation does not do automatically. */
  notEnforced: string[];
}

export const EVIDENCE_POLICY: EvidencePolicy = {
  version: EVIDENCE_POLICY_VERSION,
  collected: [
    "Every submission you make: the code, the language, and when it was submitted.",
    "What happened when it ran: automated test outcomes and scores, and your program's output on the visible tests.",
    "Autosaved drafts of your current code (the latest draft only, so you can reload).",
    "Hints you request: which stage, when, and the guidance text you were shown.",
    "Transfer Check attempts, recorded separately from your assessment score.",
    "Focus and fullscreen changes during the exam, recorded as plain events with a timestamp.",
  ],
  notCollected: [
    "Keystrokes, typing speed or rhythm.",
    "Clipboard contents or paste sizes.",
    "Screen, camera or audio recordings.",
    "Mouse movement, device or browser fingerprints.",
    "Any score, probability or profile about you beyond the assessment marks.",
  ],
  association:
    "Everything above is attached to this one assessment session; it is never merged with another session or another student.",
  access: [
    "You can see your own submissions, results and hints for this session.",
    "Instructors of your section can see the same record, attempt by attempt, to review your work.",
    "Hidden test inputs and expected outputs are never shown to you, and your program's output on hidden tests is never shown to anyone.",
  ],
  retention: [
    "The record is kept as part of the course's assessment records for as long as the course record is kept.",
    "Removal is a manual administrative action on the course data.",
  ],
  notEnforced: [
    "No automatic deletion or expiry runs; retention is a policy, not a scheduled process.",
    "Acknowledging this notice is recorded when given; starting an assessment is not blocked without it.",
  ],
};
