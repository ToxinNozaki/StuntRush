export const MAX_CHAT_LENGTH = 120;
export const MAX_NICKNAME_LENGTH = 16;

/**
 * A short, deliberately basic list — catches the most common profanity typed in a
 * hurry. This is NOT a moderation system: it's a client-side courtesy filter for a
 * casual multiplayer sandbox between classmates on the same LAN/room, the same trust
 * model the rest of multiplayer already uses (see DESIGN_DOC.md's Risks table). Both
 * the sender and every receiver run this, so a modified client could bypass it —
 * that's an accepted limitation, not an oversight.
 */
const BLOCKED_WORDS = [
  "fuck",
  "shit",
  "bitch",
  "asshole",
  "bastard",
  "cunt",
  "dick",
  "piss",
  "slut",
  "whore",
  "nigger",
  "nigga",
  "fag",
  "retard",
];

function maskProfanity(text: string): string {
  return text.replace(/[A-Za-z]+/g, (word) =>
    BLOCKED_WORDS.includes(word.toLowerCase()) ? "*".repeat(word.length) : word
  );
}

/**
 * Trims, strips control characters, caps length, and masks the blocked-word list.
 * Call this on outgoing text before it's sent AND on incoming text before it's
 * displayed — both sides matter, since the sender's own filtering can't be trusted
 * once the text has left their machine.
 */
export function sanitizeChatText(raw: string): string {
  return sanitize(raw, MAX_CHAT_LENGTH);
}

/** Same filtering as chat text, just capped shorter — for the player nickname shown
 *  to other players instead of the auto-assigned "Player" fallback. */
export function sanitizeNickname(raw: string): string {
  return sanitize(raw, MAX_NICKNAME_LENGTH);
}

function sanitize(raw: string, maxLength: number): string {
  const stripped = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim()
    .slice(0, maxLength);
  return maskProfanity(stripped);
}
