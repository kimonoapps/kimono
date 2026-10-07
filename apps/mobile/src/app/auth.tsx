import { Redirect } from "expo-router";

/* Where the sign-in page sends the browser sheet back to. The sheet itself
   reads the result; if the link ever opens the app directly, go home. */
export default function AuthReturn() {
  return <Redirect href="/" />;
}
