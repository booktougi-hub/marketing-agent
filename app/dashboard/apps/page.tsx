import Link from "next/link";
import { Plus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function AppsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Your Apps</h1>
        <Link href="/dashboard/apps/new" className={buttonVariants()}>
          <Plus />
          Add App
        </Link>
      </div>

      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-4 py-16 text-center">
          <p className="max-w-sm text-sm text-muted-foreground">
            No apps yet. Add your first app to start marketing
            automatically.
          </p>
          <Link href="/dashboard/apps/new" className={buttonVariants()}>
            Add your first app
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
