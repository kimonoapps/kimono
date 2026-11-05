/** Adapted from rmp-api main.py, queries.py and utils.py, commit 4e83474. */
import { ApiError } from "./mawaqit";

const endpoint = "https://www.ratemyprofessors.com/graphql";
const headers = {
  "Content-Type": "application/json",
  Accept: "application/json",
  Authorization: "Basic dGVzdDp0ZXN0",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Referer: "https://www.ratemyprofessors.com/",
  Origin: "https://www.ratemyprofessors.com",
};

const schoolQuery = `query NewSearchSchoolsQuery($query: SchoolSearchQuery!) {
  newSearch { schools(query: $query) { edges { node { id legacyId name city state numRatings avgRatingRounded } } } }
}`;

const teacherQuery = `query TeacherSearchResultsPageQuery($query: TeacherSearchQuery!) {
  search: newSearch { teachers(query: $query, first: 1) { edges { node { legacyId } } } }
}`;

const teacherRatingsQuery = `query TeacherRatingsPageQuery($id: ID!) {
  node(id: $id) {
    __typename
    ... on Teacher {
      legacyId firstName lastName department
      school { legacyId name city state }
      avgRating avgDifficulty numRatings wouldTakeAgainPercent
      teacherRatingTags { tagName }
      courseCodes { courseCount courseName }
      ratings(first: 20) { edges { node { comment clarityRating helpfulRating difficultyRating date class grade ratingTags wouldTakeAgain textbookUse } } }
      relatedTeachers { legacyId firstName lastName avgRating }
    }
  }
}`;

type Node = Record<string, unknown>;
const record = (value: unknown): Node => (value && typeof value === "object" && !Array.isArray(value) ? (value as Node) : {});
const list = (value: unknown): Node[] => (Array.isArray(value) ? value.map(record) : []);
const edges = (value: unknown) => list(record(value).edges).map((edge) => record(edge.node));

/** Accepts a numeric legacy ID or RateMyProfessors' base64 "School-N" ID. */
export function schoolId(value: string) {
  const text = value.trim();
  if (/^\d{1,12}$/.test(text)) return Buffer.from(`School-${text}`).toString("base64");
  if (/^[A-Za-z0-9+/]{4,40}={0,2}$/.test(text) && /^School-\d{1,12}$/.test(Buffer.from(text, "base64").toString("utf8"))) return text;
  throw new ApiError(400, "invalid_school", "school must be a numeric school ID or a RateMyProfessors school ID.");
}

export function flag(query: URLSearchParams, name: string) {
  const value = query.get(name);
  if (value === null || value === "" || value === "false") return false;
  if (value === "true") return true;
  throw new ApiError(400, "invalid_parameter", `${name} must be true or false.`);
}

function text(query: URLSearchParams, name: string) {
  const value = query.get(name)?.trim() || "";
  if (value.length < 2 || value.length > 120) throw new ApiError(400, "invalid_query", `${name} must contain 2 to 120 characters.`);
  return value;
}

async function graphql(query: string, variables: Record<string, unknown>) {
  let raw = "";
  try {
    const response = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify({ query, variables }), redirect: "error", signal: AbortSignal.timeout(10000) });
    if (!response.ok || !response.body) throw new ApiError(502, "upstream_error", "RateMyProfessors is temporarily unavailable.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder(); let length = 0;
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > 2 * 1024 * 1024) { await reader.cancel(); throw new ApiError(502, "invalid_upstream", "Upstream response is too large."); }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(502, "upstream_unavailable", "Could not reach RateMyProfessors. Try again later.");
  }
  try { return record(record(JSON.parse(raw)).data); }
  catch { throw new ApiError(502, "invalid_upstream", "Invalid RateMyProfessors response."); }
}

export function formatProfessor(node: Node, ratings: boolean, related: boolean) {
  const school = record(node.school);
  const result: Node = {
    found: true,
    id: node.legacyId ?? null,
    firstName: node.firstName ?? null,
    lastName: node.lastName ?? null,
    name: [node.firstName, node.lastName].filter((part) => typeof part === "string" && part).join(" "),
    department: node.department ?? null,
    school: { name: school.name ?? null, id: school.legacyId ?? null, city: school.city ?? null, state: school.state ?? null },
    avgRating: node.avgRating ?? null,
    avgDifficulty: node.avgDifficulty ?? null,
    numRatings: node.numRatings ?? null,
    wouldTakeAgainPercent: node.wouldTakeAgainPercent ?? null,
    courses: list(node.courseCodes).map((course) => ({ name: course.courseName ?? null, count: typeof course.courseCount === "number" ? course.courseCount : 0 })).sort((a, b) => b.count - a.count),
    tags: list(node.teacherRatingTags).map((tag) => tag.tagName).filter((tag) => typeof tag === "string"),
  };
  if (ratings) result.ratings = edges(node.ratings).map((rating) => ({
    comment: rating.comment ?? null,
    clarity: rating.clarityRating ?? null,
    helpful: rating.helpfulRating ?? null,
    difficulty: rating.difficultyRating ?? null,
    date: rating.date ?? null,
    class: rating.class ?? null,
    grade: rating.grade ?? null,
    tags: typeof rating.ratingTags === "string" && rating.ratingTags ? rating.ratingTags.split("--") : [],
    takeAgain: rating.wouldTakeAgain ?? null,
    textbook: rating.textbookUse ?? null,
  }));
  if (related) result.relatedProfessors = list(node.relatedTeachers).map((teacher) => ({
    id: teacher.legacyId ?? null,
    name: [teacher.firstName, teacher.lastName].filter((part) => typeof part === "string" && part).join(" "),
    rating: teacher.avgRating ?? null,
  }));
  return result;
}

export async function executeRmp(operation: string, query: URLSearchParams) {
  if (operation === "schools") {
    const data = await graphql(schoolQuery, { query: { text: text(query, "q") } });
    return { schools: edges(record(record(data.newSearch).schools)).slice(0, 50) };
  }
  if (operation === "professor") {
    const ratings = flag(query, "ratings"), related = flag(query, "related");
    const search = await graphql(teacherQuery, { query: { text: text(query, "name"), schoolID: schoolId(query.get("school") || ""), fallback: true, departmentID: null } });
    const legacyId = edges(record(record(search.search).teachers))[0]?.legacyId;
    if (typeof legacyId !== "number" && typeof legacyId !== "string") return { found: false };
    const details = await graphql(teacherRatingsQuery, { id: Buffer.from(`Teacher-${legacyId}`).toString("base64") });
    const node = record(details.node);
    if (node.__typename !== "Teacher") return { found: false };
    return formatProfessor(node, ratings, related);
  }
  throw new ApiError(404, "unknown_endpoint", "Endpoint not found.");
}
