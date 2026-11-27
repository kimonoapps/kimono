import { peopleRequest } from "@/lib/people";

export const dynamic = "force-dynamic";

/** People on this Kimono, by name (`?q=`, three letters at least) or by known usernames (`?u=a,b`). Never everyone. */
export const GET = peopleRequest;
