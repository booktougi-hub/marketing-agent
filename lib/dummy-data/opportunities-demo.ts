// TODO(cleanup-before-prod): delete this file and its one import in
// components/apps/app-opportunities-view.tsx before shipping to
// production. This exists purely so the Opportunities tab's real UI can be
// previewed with realistic-looking cards before any real
// forum-opportunity-finder run has produced findings for a given app — it
// is not a fallback for missing integrations (unlike lib/demoData/*, which
// covers features that genuinely aren't built yet). The real feature
// behind this page already works end to end; this is just sample content.
import type { ResearchFinding } from "@/types";

export type DemoOpportunityFinding = Pick<ResearchFinding, "id" | "findings" | "status" | "created_at">;

const now = Date.now();
const daysAgo = (n: number) => new Date(now - n * 24 * 60 * 60 * 1000).toISOString();

export const DEMO_OPPORTUNITY_FINDINGS: DemoOpportunityFinding[] = [
  {
    id: "demo-opp-1",
    status: "active",
    created_at: daysAgo(1),
    findings: {
      platform: "reddit",
      source_name: "r/SaaS",
      title: "How do you all handle marketing when you're a solo dev with zero time?",
      url: "https://www.reddit.com/r/SaaS/comments/example1",
      content:
        "I built a small dev tool and it's getting some organic signups but I have literally no time for marketing. Every guide assumes you have hours a day to spend on content/socials. Anyone found a way to keep marketing running without babysitting it constantly?",
      posted_at: daysAgo(1),
      engagement_count: 143,
      relevance: "high",
      drafted_reply:
        "Same boat until recently — the thing that actually moved the needle for me was picking ONE channel and automating the boring parts (scheduling, first-draft copy) so I only spend time reviewing, not producing from scratch. Happy to share what that setup looks like if useful.",
    },
  },
  {
    id: "demo-opp-2",
    status: "active",
    created_at: daysAgo(3),
    findings: {
      platform: "hackernews",
      source_name: "Hacker News",
      title: "Ask HN: What's your stack for auto-generating social content from a blog?",
      url: "https://news.ycombinator.com/item?id=example2",
      content:
        "Curious what people are using to turn long-form posts into Twitter/LinkedIn content automatically. Most tools I've tried produce pretty generic-sounding output.",
      posted_at: daysAgo(3),
      engagement_count: 67,
      relevance: "medium",
      drafted_reply:
        "The generic-output problem usually comes down to not grounding the generation in anything specific about the product/audience — worth checking whether whatever you use lets you feed in real positioning/tone rather than just the raw text.",
    },
  },
  {
    id: "demo-opp-3",
    status: "active",
    created_at: daysAgo(6),
    findings: {
      platform: "quora",
      source_name: "Quora",
      title: "What is the best way for an indie developer to market an app with no budget?",
      url: "https://www.quora.com/example3",
      content:
        "I'm a solo developer and just launched my first app. I have $0 for ads. What actually works at this stage?",
      posted_at: daysAgo(6),
      engagement_count: 29,
      relevance: "high",
      drafted_reply:
        "At zero budget, the highest-leverage thing is usually showing up in the exact places your users already ask this question — threads like this one, relevant subreddits, and Dev.to/HN if it's a technical audience. Consistency beats intensity here.",
    },
  },
  {
    id: "demo-opp-4",
    status: "active",
    created_at: daysAgo(10),
    findings: {
      platform: "x",
      source_name: "X",
      title: "Thread: indie hackers, what's eating most of your week that you wish was automated?",
      url: "https://x.com/example/status/example4",
      content:
        "Doing an informal poll — replying with what part of running your SaaS takes the most manual time each week.",
      posted_at: daysAgo(10),
      engagement_count: 512,
      relevance: "low",
      drafted_reply:
        "For me it was consistently posting/scheduling across platforms — ended up automating the drafting + scheduling step and just reviewing before it goes out.",
    },
  },
];
