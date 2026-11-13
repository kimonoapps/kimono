import { ProfileView } from "../../friends/friends-ui";
import "../../friends/friends.css";

export const metadata = { title: "Profile" };

export default async function PersonPage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  return <ProfileView username={decodeURIComponent(username)} />;
}
