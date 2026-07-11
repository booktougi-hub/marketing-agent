import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NAV_ITEMS } from "@/components/dashboard/nav-items";

const SERVICE_DESCRIPTIONS: Record<string, string> = {
  content: "Generated posts and drafts for your channels.",
  opportunities: "Community threads and conversations worth joining.",
  outreach: "Cold email prospects and sequences.",
  research: "App DNA, competitor gaps, and topic research.",
  strategy: "Personas, content pillars, and channel plan.",
};

export function AppServicesView({
  appId,
  appName,
}: {
  appId: string;
  appName: string;
}) {
  const services = NAV_ITEMS.filter(
    (item) => item.section !== "overview" && item.section !== "settings"
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{appName}</h1>
        <p className="text-sm text-muted-foreground">Services</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {services.map((service) => {
          const Icon = service.icon;
          return (
            <Link key={service.section} href={service.href(appId)}>
              <Card className="h-full transition-colors hover:bg-accent/50">
                <CardHeader className="flex flex-row items-center gap-2 space-y-0">
                  <span className="flex h-8 w-8 items-center justify-center rounded-md bg-accent text-accent-foreground">
                    <Icon className="h-4 w-4" />
                  </span>
                  <CardTitle>{service.label}</CardTitle>
                </CardHeader>
                <CardContent className="flex items-center justify-between gap-2">
                  <p className="text-sm text-muted-foreground">
                    {SERVICE_DESCRIPTIONS[service.section]}
                  </p>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
