import { redirect } from "next/navigation";

// The Content tab is the canonical first stop for an app: it walks the user
// through the strategy approval flow (personas/pillars/approve/regenerate)
// before showing the content calendar once approved, so anything landing on
// the bare app route goes straight there.
export default async function AppRootPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/dashboard/apps/${id}/content`);
}
