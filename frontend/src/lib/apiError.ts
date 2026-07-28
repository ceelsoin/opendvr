import axios from "axios";

/**
 * Extracts a user-facing message from an Express error response shaped like
 * `{ error, details? }` (see backend/src/lib/errors.ts), falling back to a
 * generic message for non-API errors (network failure, etc).
 */
export function extractErrorMessage(err: unknown, fallback: string): string {
  const data = axios.isAxiosError(err)
    ? (err.response?.data as { error?: string; details?: string } | undefined)
    : undefined;
  const base = data?.error ?? fallback;
  return data?.details ? `${base} (${data.details})` : base;
}
