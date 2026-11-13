import { apiError } from "@/lib/api-v1";
import { ReadProblem } from "@/lib/kimono-read";

/** A ReadProblem is a sentence for the person; anything else is the server's. */
export function readFailure(error: unknown) {
  if (error instanceof ReadProblem) return apiError(error.status, error.message);
  console.error("Kimono Read:", error);
  return apiError(500, "Kimono Read pairing isn't working right now.");
}
