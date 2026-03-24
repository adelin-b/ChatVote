import { redirect } from "next/navigation";

export default async function DataSourcesRedirect({
  params,
}: {
  params: Promise<{ secret: string }>;
}) {
  const { secret: rawSecret } = await params;
  const secret = decodeURIComponent(rawSecret).replace(/\s+/g, "");
  redirect(`/admin/dashboard/${secret}?tab=pipeline`);
}
