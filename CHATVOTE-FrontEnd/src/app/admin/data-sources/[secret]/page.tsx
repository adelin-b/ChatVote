import { redirect } from "next/navigation";

export default async function DataSourcesRedirect({
  params,
}: {
  params: Promise<{ secret: string }>;
}) {
  const { secret } = await params;
  redirect(`/admin/dashboard/${secret}?tab=pipeline`);
}
