/**
 * Priority Resolver Module
 * Handles token priority score assignment based on source and creation time
 */

import { TokenSource } from '@models/enums';

/**
 * Priority score configuration
 * Higher score = higher priority
 */
const PRIORITY_SCORES: Record<TokenSource, number> = {
  [TokenSource.EMERGENCY]: 100,
  [TokenSource.PAID]: 75,
  [TokenSource.FOLLOW_UP]: 50,
  [TokenSource.ONLINE]: 40,
  [TokenSource.WALKIN]: 25,
};

/**
 * Get base priority score for a token source
 *
 * @param tokenSource - The source of the token
 * @returns Priority score (higher = higher priority)
 *
 * Priority order (highest to lowest):
 * - EMERGENCY: 100
 * - PAID: 75
 * - FOLLOW_UP: 50
 * - ONLINE: 40
 * - WALKIN: 25
 */
export function getPriorityScore(tokenSource: TokenSource): number {
  const score = PRIORITY_SCORES[tokenSource];

  if (!score && score !== 0) {
    throw new Error(`Unknown token source: ${tokenSource}`);
  }

  return score;
}

/**
 * Compare two tokens for priority ordering
 * Returns a value suitable for Array.sort()
 *
 * @param token1Source - First token's source
 * @param token1CreatedAt - First token's creation time
 * @param token2Source - Second token's source
 * @param token2CreatedAt - Second token's creation time
 * @returns Negative if token1 has higher priority, positive if token2 has higher priority
 *
 * Comparison logic:
 * 1. Higher priority score wins
 * 2. If scores equal, earlier createdAt wins (FIFO)
 */
export function compareTokenPriority(
  token1Source: TokenSource,
  token1CreatedAt: Date,
  token2Source: TokenSource,
  token2CreatedAt: Date,
): number {
  const score1 = getPriorityScore(token1Source);
  const score2 = getPriorityScore(token2Source);

  // Primary sort: by priority score (descending - higher score first)
  if (score1 !== score2) {
    return score2 - score1;
  }

  // Secondary sort: by creation time (ascending - earlier first for tie-breaking)
  return token1CreatedAt.getTime() - token2CreatedAt.getTime();
}

/**
 * Get priority description for display purposes
 *
 * @param tokenSource - The source of the token
 * @returns Human-readable priority level
 */
export function getPriorityLevel(tokenSource: TokenSource): string {
  const score = getPriorityScore(tokenSource);

  if (score >= 100) return 'CRITICAL';
  if (score >= 75) return 'HIGH';
  if (score >= 50) return 'MEDIUM';
  if (score >= 40) return 'LOW';
  return 'VERY_LOW';
}
