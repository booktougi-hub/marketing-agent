// Suspense boundary for every page nested under app/dashboard/apps/[id]/*
// (there's no layout.tsx at this level, so this loading.tsx covers all of
// them — overview, content, analytics, audits, settings, etc.). Every one
// of those pages does a handful of sequential Supabase round-trips with no
// caching, so without this boundary a nav click or app-switch just left the
// previous page frozen on screen with zero feedback until the new page's
// full data fetch resolved. This renders instantly instead, in the same
// "title + cards" shape most of those pages share.
export default function AppSectionLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="h-7 w-56 animate-pulse rounded-md bg-muted" />
        <div className="h-4 w-24 animate-pulse rounded-md bg-muted" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex flex-col gap-3 rounded-lg border bg-card p-6">
            <div className="h-4 w-32 animate-pulse rounded-md bg-muted" />
            <div className="h-8 w-16 animate-pulse rounded-md bg-muted" />
          </div>
        ))}
      </div>

      <div className="h-64 animate-pulse rounded-lg border bg-card" />
    </div>
  );
}
