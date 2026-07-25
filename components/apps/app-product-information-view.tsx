import { Globe, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PRODUCT_TYPE_LABEL } from "@/lib/discovery-query-builder";
import type { AppDna, AppStatus, ProductType } from "@/types";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="text-sm">{children}</div>
    </div>
  );
}

export function AppProductInformationView({
  sourceUrl,
  productType,
  status,
  dna,
}: {
  sourceUrl: string;
  productType: ProductType;
  status: AppStatus;
  dna: AppDna | null;
}) {
  if (!dna) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          {status === "error" ? (
            <Badge variant="destructive">Error</Badge>
          ) : (
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          )}
          <p className="max-w-sm text-sm text-muted-foreground">
            {status === "error"
              ? "Something went wrong while extracting this app's product information."
              : "Extracting product information from your app's website..."}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{dna.name}</CardTitle>
          <p className="text-sm text-muted-foreground">{dna.tagline}</p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Category">
              <Badge variant="outline" className="capitalize">
                {PRODUCT_TYPE_LABEL[productType]}
              </Badge>
            </Field>
            <Field label="Source URL">
              <a
                href={sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-primary hover:underline"
              >
                <Globe className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{sourceUrl}</span>
              </a>
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Problem it solves</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{dna.problem}</p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Key features</CardTitle>
          </CardHeader>
          <CardContent>
            {dna.features.length === 0 ? (
              <p className="text-sm text-muted-foreground">No features listed.</p>
            ) : (
              <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
                {dna.features.map((feature, i) => (
                  <li key={i}>{feature}</li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Competitors</CardTitle>
          </CardHeader>
          <CardContent>
            {dna.competitors.length === 0 ? (
              <p className="text-sm text-muted-foreground">No competitors identified.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {dna.competitors.map((competitor, i) => (
                  <Badge key={i} variant="secondary">
                    {competitor}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="grid grid-cols-1 gap-4 py-6 sm:grid-cols-2">
          <Field label="Target audience">{dna.target_audience}</Field>
          <Field label="Pricing">{dna.pricing}</Field>
        </CardContent>
      </Card>

      {dna.additional_urls.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Additional URLs</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {dna.additional_urls.map((url, i) => (
              <a
                key={i}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate text-sm text-primary hover:underline"
              >
                {url}
              </a>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
