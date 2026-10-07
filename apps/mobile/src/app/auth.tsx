import { Redirect } from "expo-router";
import { useSession } from "@/lib/session";

/* Where the sign-in page sends the browser sheet back to. On Android the link
   also opens this route while the sign-in is still finishing, so it follows
   the session: back to the sign-in screen until it lands, then home. */
export default function AuthReturn() {
  const { status } = useSession();
  return <Redirect href={status === "signed-in" ? "/" : "/sign-in"} />;
}
