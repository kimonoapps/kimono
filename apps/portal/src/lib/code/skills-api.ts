import { apiJson, type ApiUser } from "@/lib/api-v1";
import { db } from "@/lib/code";
import { skillsOf, type SkillViewer } from "./skills";

/** Owners and admins can change or take down anyone's published skill. */
export const skillViewer = (user: ApiUser): SkillViewer => ({ username: user.username, admin: user.role === "owner" || user.role === "admin" });

/** The catalog as this person has it, and whether they're an admin. Everyone may publish their own. */
export const skillsCatalog = (user: ApiUser) => apiJson({ skills: skillsOf(db(), skillViewer(user)), admin: skillViewer(user).admin });
