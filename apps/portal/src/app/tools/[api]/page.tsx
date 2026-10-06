import { DocumentationPage } from "../documentation-page";
export const metadata = { title: "Kimono Tools · API reference" };
export default async function ApiPage({ params, searchParams }: { params: Promise<{ api: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { api } = await params;
  const query = await searchParams;
  return <DocumentationPage selectedId={api} openKeyDrawer={query["create-key"] === "1"} />;
}
