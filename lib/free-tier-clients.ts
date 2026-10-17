import { FREE_TIER_CLIENT_LIMIT } from "@/lib/ai-usage";

// The free plan's client limit (migration 0397): the database refuses a new training client past FREE_TIER_CLIENT_LIMIT with this sentence (kept the same in SQL; a test checks they match), and a person joining on
// their own is only ever told the coach cannot take new clients right now. The routes that add a client turn the database's refusal into a plain 403 with this wording.
export const clientLimitMessage = (): string => `Your free plan includes up to ${FREE_TIER_CLIENT_LIMIT} clients. Subscribe to add more.`;
export const CLIENT_LIMIT_NEUTRAL_MESSAGE = "This coach cannot take on new clients right now.";

export function isClientLimitError(message: string | null | undefined): boolean {
  return !!message && (message.includes(clientLimitMessage()) || message.includes(CLIENT_LIMIT_NEUTRAL_MESSAGE));
}
