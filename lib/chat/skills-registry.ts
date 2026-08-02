import "server-only";

// Every marketing-domain skill under .claude/skills/, mapped to its SKILL.md
// path — the source list get_marketing_playbook (lib/chat/tools.ts) reads
// from at request time. Verified 1:1 against the actual .claude/skills/
// directory contents (47 marketing-domain skills, each with a SKILL.md);
// keep this in sync if a skill is ever added, renamed, or removed. The
// trigger-* skills (trigger-getting-started, trigger-authoring-tasks, ...)
// are deliberately excluded — those are for Claude Code authoring this
// codebase's own background jobs, not marketing guidance for the founder.
//
// `popups` and `paywalls` are included for advisory answers only — see the
// hard constraint in lib/chat/tools.ts's get_marketing_playbook comment:
// never build a mutating tool/action for either, since this product doesn't
// embed code in a customer's live app.
export const MARKETING_SKILLS: Record<string, string> = {
  "ab-testing": ".claude/skills/ab-testing/SKILL.md",
  "ad-creative": ".claude/skills/ad-creative/SKILL.md",
  ads: ".claude/skills/ads/SKILL.md",
  "ai-seo": ".claude/skills/ai-seo/SKILL.md",
  analytics: ".claude/skills/analytics/SKILL.md",
  aso: ".claude/skills/aso/SKILL.md",
  "churn-prevention": ".claude/skills/churn-prevention/SKILL.md",
  "co-marketing": ".claude/skills/co-marketing/SKILL.md",
  "cold-email": ".claude/skills/cold-email/SKILL.md",
  "community-marketing": ".claude/skills/community-marketing/SKILL.md",
  "competitor-profiling": ".claude/skills/competitor-profiling/SKILL.md",
  competitors: ".claude/skills/competitors/SKILL.md",
  "content-strategy": ".claude/skills/content-strategy/SKILL.md",
  "copy-editing": ".claude/skills/copy-editing/SKILL.md",
  copywriting: ".claude/skills/copywriting/SKILL.md",
  cro: ".claude/skills/cro/SKILL.md",
  "customer-research": ".claude/skills/customer-research/SKILL.md",
  "directory-submissions": ".claude/skills/directory-submissions/SKILL.md",
  emails: ".claude/skills/emails/SKILL.md",
  "free-tools": ".claude/skills/free-tools/SKILL.md",
  image: ".claude/skills/image/SKILL.md",
  launch: ".claude/skills/launch/SKILL.md",
  "lead-magnets": ".claude/skills/lead-magnets/SKILL.md",
  "marketing-council": ".claude/skills/marketing-council/SKILL.md",
  "marketing-ideas": ".claude/skills/marketing-ideas/SKILL.md",
  "marketing-loops": ".claude/skills/marketing-loops/SKILL.md",
  "marketing-plan": ".claude/skills/marketing-plan/SKILL.md",
  "marketing-psychology": ".claude/skills/marketing-psychology/SKILL.md",
  offers: ".claude/skills/offers/SKILL.md",
  onboarding: ".claude/skills/onboarding/SKILL.md",
  paywalls: ".claude/skills/paywalls/SKILL.md", // advisory only, see B3
  popups: ".claude/skills/popups/SKILL.md", // advisory only, see B3
  pricing: ".claude/skills/pricing/SKILL.md",
  "product-marketing": ".claude/skills/product-marketing/SKILL.md",
  "programmatic-seo": ".claude/skills/programmatic-seo/SKILL.md",
  prospecting: ".claude/skills/prospecting/SKILL.md",
  "public-relations": ".claude/skills/public-relations/SKILL.md",
  referrals: ".claude/skills/referrals/SKILL.md",
  revops: ".claude/skills/revops/SKILL.md",
  "sales-enablement": ".claude/skills/sales-enablement/SKILL.md",
  schema: ".claude/skills/schema/SKILL.md",
  "seo-audit": ".claude/skills/seo-audit/SKILL.md",
  signup: ".claude/skills/signup/SKILL.md",
  "site-architecture": ".claude/skills/site-architecture/SKILL.md",
  sms: ".claude/skills/sms/SKILL.md",
  social: ".claude/skills/social/SKILL.md",
  video: ".claude/skills/video/SKILL.md",
};

export type MarketingSkillTopic = keyof typeof MARKETING_SKILLS;
