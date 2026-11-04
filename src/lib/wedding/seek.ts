/** Chat commands for Seek. New games can add a branch here without a new bot. */
import { seekMention } from "./seek/normalizer";

export type SeekIntent = "start" | "help" | "ask";

export const SEEK_NAME = "Seek";
export const SEEK_PROMPT = "Who said it?";
export const SEEK_HELP = "I'm Seek, an automated companion — not a person. Don't scroll. Just ask. @seek start who said it · @seek find decoration messages · @seek did Aman finish decorations?";
export const SEEK_BUSY = "This round has to finish before another one can start.";
export const SEEK_JOIN = "Join this wedding before starting a round.";

/** A message addresses Seek when @seek appears as its own word, including mid-sentence. */
export function parseSeek(raw: string): SeekIntent | null {
  const rest = seekMention(raw);
  if (rest === null) return null;
  if (rest === "start who said it") return "start";
  if (!rest || rest === "help" || rest === "what can you do") return "help";
  return "ask";
}
