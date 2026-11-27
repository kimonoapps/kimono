import { peopleRequest } from "@/lib/people";

export const dynamic = "force-dynamic";

/** Who a notebook or note can be shared with: found by name or looked up by username (lib/people). Never everyone. */
export const GET = peopleRequest;
