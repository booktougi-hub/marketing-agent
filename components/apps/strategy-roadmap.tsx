import Link from "next/link";
import {
  CheckCircle2,
  Compass,
  FileText,
  Send,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface RoadmapStep {
  title: string;
  description: string;
  icon: LucideIcon;
  href?: string;
  colorVar: string;
  done?: boolean;
}

export function StrategyRoadmap({ appId }: { appId: string }) {
  const steps: RoadmapStep[] = [
    {
      title: "Strategy approved",
      description: "Your personas, pillars, and channels are locked in and guiding every post.",
      icon: CheckCircle2,
      colorVar: "var(--chart-2)",
      done: true,
    },
    {
      title: "Generate & schedule content",
      description: "AI drafts posts for each pillar and slots them onto a publishing calendar.",
      icon: FileText,
      href: `/dashboard/apps/${appId}/content`,
      colorVar: "var(--chart-1)",
    },
    {
      title: "Auto-publish everywhere",
      description: "Scheduled posts go out to your connected channels automatically.",
      icon: Send,
      href: `/dashboard/apps/${appId}/content`,
      colorVar: "var(--chart-3)",
    },
    {
      title: "Find community opportunities",
      description: "Surface forums and threads where your personas are already looking for answers.",
      icon: Compass,
      href: `/dashboard/apps/${appId}/opportunities`,
      colorVar: "var(--chart-5)",
    },
    {
      title: "Track results & iterate",
      description: "Watch performance on Overview, then regenerate the strategy whenever it needs a refresh.",
      icon: TrendingUp,
      href: `/dashboard/apps/${appId}/overview`,
      colorVar: "var(--chart-6)",
    },
  ];

  return (
    <Card>
      <CardContent className="flex flex-col gap-5">
        <div>
          <h3 className="text-base font-semibold tracking-tight">Execution Roadmap</h3>
          <p className="text-xs text-muted-foreground">
            Follow this path to turn the strategy into real traction.
          </p>
        </div>

        {/* Desktop / wide: horizontal path with a connecting line through the circles. */}
        <div className="hidden lg:grid lg:grid-cols-5 lg:gap-2">
          {steps.map((step, i) => (
            <div key={step.title} className="flex flex-col items-center text-center">
              <div className="flex w-full items-center">
                <div
                  className={cn("h-px flex-1", i === 0 && "invisible")}
                  style={{ backgroundColor: "var(--border)" }}
                />
                <StepCircle step={step} />
                <div
                  className={cn("h-px flex-1", i === steps.length - 1 && "invisible")}
                  style={{ backgroundColor: "var(--border)" }}
                />
              </div>
              <StepBody step={step} align="center" />
            </div>
          ))}
        </div>

        {/* Narrow: vertical timeline. */}
        <div className="flex flex-col lg:hidden">
          {steps.map((step, i) => (
            <div key={step.title} className="flex gap-3">
              <div className="flex flex-col items-center">
                <StepCircle step={step} />
                {i < steps.length - 1 && (
                  <div className="my-1 min-h-6 w-px flex-1" style={{ backgroundColor: "var(--border)" }} />
                )}
              </div>
              <div className={cn(i < steps.length - 1 && "pb-4")}>
                <StepBody step={step} align="left" />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function StepCircle({ step }: { step: RoadmapStep }) {
  const Icon = step.icon;
  const circle = (
    <span
      className={cn(
        "flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 transition-transform",
        step.href && "hover:scale-105"
      )}
      style={
        step.done
          ? { backgroundColor: step.colorVar, borderColor: step.colorVar, color: "var(--card)" }
          : {
              backgroundColor: `color-mix(in oklch, ${step.colorVar} 14%, var(--card))`,
              borderColor: step.colorVar,
              color: step.colorVar,
            }
      }
    >
      <Icon className="size-5" />
    </span>
  );
  if (!step.href) return circle;
  return (
    <Link href={step.href} aria-label={step.title}>
      {circle}
    </Link>
  );
}

function StepBody({ step, align }: { step: RoadmapStep; align: "center" | "left" }) {
  const content = (
    <div className={cn("flex flex-col gap-0.5 pt-2", align === "center" ? "items-center" : "items-start")}>
      <p className="text-sm font-semibold">{step.title}</p>
      <p className={cn("text-xs text-muted-foreground", align === "center" && "max-w-[11rem]")}>
        {step.description}
      </p>
    </div>
  );
  if (!step.href) return content;
  return (
    <Link href={step.href} className="transition-opacity hover:opacity-80">
      {content}
    </Link>
  );
}
