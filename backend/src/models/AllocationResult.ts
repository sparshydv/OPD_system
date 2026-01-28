/**
 * Allocation Result Interface
 * Returned from allocation operations
 */
export interface AllocationResult {
  success: boolean;
  tokenId?: string;
  message: string;
  evictedTokenId?: string;
  evictionReason?: string;
  code: string;
}
