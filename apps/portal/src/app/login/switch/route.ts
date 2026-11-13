import { signIn } from "@/auth";

/**
 * Signs in again as whoever the identity provider says is here, whatever
 * session this browser already had. After an administrator starts or stops
 * signing in as someone, this is how Kimono catches up: Kimono's tile in the
 * identity provider opens here, and so does Stop.
 */
export async function GET() {
  await signIn("authentik", { redirectTo: "/" });
}
