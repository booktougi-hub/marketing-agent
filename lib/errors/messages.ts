// Single source of truth for every user-facing error message in the app.
// Every error message added from here on goes into this file, under the
// correct domain — never as a raw string inline in a route, job, or
// component.
export const ErrorMessages = {
  auth: {
    UNAUTHORIZED: "You need to be signed in to do that.",
    SESSION_EXPIRED: "Your session has expired. Please sign in again.",
    NO_WORKSPACE: "We could not find your workspace. Please contact support.",
  },
  apps: {
    NOT_FOUND: "App not found.",
    NOT_FOUND_IN_WORKSPACE: "App not found in this workspace.",
    INVALID_URL: "Please provide a valid URL.",
    PLAN_LIMIT_REACHED: "Upgrade to Solo to add more apps.",
    URL_LOCKED: "The app URL has already been changed once.",
    ALREADY_DELETED: "This app has already been deleted.",
    DELETE_CONFIRMATION_MISMATCH: "The app name you entered does not match.",
    NOT_AWAITING_APPROVAL: "This app is not awaiting approval.",
    NOT_ACTIVE: "Only active apps can regenerate their strategy.",
    NO_DNA: "This app has no DNA yet.",
    NO_CREDITS_REMAINING: "No re-analysis credits remaining. Upgrade your plan for more credits.",
    CREATE_FAILED: "Failed to create app.",
    UPDATE_FAILED: "Failed to save changes.",
    NO_CHANGES_PROVIDED: "No changes provided.",
    DELETE_FAILED: "Failed to delete app.",
    PAUSE_UPDATE_FAILED: "Failed to update pause state.",
    TRIGGER_DNA_EXTRACTION_FAILED: "Failed to start DNA extraction.",
    TRIGGER_STRATEGY_GENERATION_FAILED: "Failed to start strategy regeneration.",
    TRIGGER_CONTENT_GENERATION_FAILED: "Failed to start content generation.",
    TRIGGER_REANALYSE_FAILED: "Failed to start re-analysis.",
  },
  strategy: {
    NO_DRAFT_TO_APPROVE: "No draft strategy found to approve.",
    NO_DRAFT_FOR_APP: "No draft strategy found for this app.",
    NO_ACTIVE_STRATEGY: "No active strategy found for this app.",
    NO_ACTIVE_STRATEGY_TO_REGENERATE: "No active strategy found to regenerate.",
    ADD_PERSONA_FAILED: "Failed to add persona.",
    ADD_PILLAR_FAILED: "Failed to add content pillar.",
    UPDATE_FAILED: "Failed to update strategy.",
    GENERATION_FAILED: "Strategy generation failed.",
  },
  research: {
    NO_CREDITS_REMAINING:
      "No manual research runs remaining this week. Upgrade for more, or wait for your next automatic weekly scan.",
    COOLDOWN_ACTIVE: "Please wait before running research again.",
    NO_FINDINGS_YET: "No research findings yet. Check back after the next scan.",
    FINDING_NOT_FOUND: "Finding not found.",
    OPPORTUNITY_NOT_FOUND: "Opportunity not found.",
    FINDING_UPDATE_FAILED: "Failed to update finding.",
    OPPORTUNITY_DISMISS_FAILED: "Failed to dismiss opportunity.",
    TYPE_MISMATCH: "This finding doesn't match the requested type.",
    INCOMPLETE_FINDING: "This finding is missing the data needed to draft a post.",
    SEED_TYPE_MISMATCH: "This finding can't be used to seed a forum search.",
    SEED_INCOMPLETE: "This finding is missing the text needed to seed a search.",
    SEED_FAILED: "Failed to queue forum search.",
    START_FAILED: "Failed to start research.",
  },
  content: {
    GENERATION_FAILED: "We could not generate content right now. Please try again.",
    INVALID_PLATFORM: "That platform is not supported yet.",
    NOT_FOUND: "Post not found.",
    EMPTY_BODY: "Post body can't be empty.",
    INVALID_STATE_EDIT: "Only scheduled or draft posts can be edited.",
    INVALID_STATE_DELETE: "Only scheduled or draft posts can be deleted.",
    UPDATE_FAILED: "Failed to update post.",
    DELETE_FAILED: "Failed to delete post.",
    CREATE_FAILED: "Failed to create draft post.",
    SAVE_GENERATED_FAILED: "Failed to save the generated post.",
    FROM_RESEARCH_FAILED: "Failed to generate a post from this finding.",
    EMPTY_LLM_OUTPUT: "Claude returned an empty post.",
  },
  prospects: {
    NOT_FOUND: "Prospect not found.",
    INVALID_STATE: "Only personalised prospects can be approved.",
    UPDATE_FAILED: "Failed to approve prospect.",
    REPLY_NOT_FOUND: "Reply not found.",
    REPLY_INVALID_STATE: "This interaction is not a reply.",
    REPLY_UPDATE_FAILED: "Failed to update reply.",
  },
  outreach: {
    NO_ICP_TO_APPROVE: "No ICP is pending review for this app.",
    APPROVE_FAILED: "Failed to approve the ICP.",
    ADJUST_FAILED: "Failed to save your adjustments.",
    TRIGGER_ICP_INFERENCE_FAILED: "Failed to start ICP re-inference.",
  },
  platforms: {
    NOT_CONFIGURED: "Server is not configured to store credentials.",
    SAVE_FAILED: "Failed to save connection.",
    DISCONNECT_FAILED: "Failed to disconnect.",
  },
  billing: {
    PAYMENT_FAILED: "Your payment could not be processed.",
    SUBSCRIPTION_NOT_FOUND: "We could not find an active subscription.",
    WEBHOOK_SIGNATURE_INVALID: "Invalid webhook signature.",
  },
  external: {
    FIRECRAWL_FAILED: "We could not read your website. Please check the URL is publicly accessible.",
    CLAUDE_FAILED: "Something went wrong while analysing your app. Please try again.",
    OPENROUTER_FAILED: "Something went wrong while generating content. Please try again.",
    POSTEVERYWHERE_FAILED: "We could not publish this post. Please check your connected accounts.",
  },
  generic: {
    UNKNOWN: "Something went wrong. Please try again.",
    VALIDATION_FAILED: "Please check your input and try again.",
    INVALID_REQUEST_BODY: "Invalid request body.",
    RATE_LIMITED: "Too many requests. Please slow down and try again.",
  },
} as const;

type ErrorMessagesShape = typeof ErrorMessages;

// Flattened, compile-time-checked union of every "domain.KEY" pair in the
// registry above, e.g. "apps.NOT_FOUND" | "auth.UNAUTHORIZED" | ... — so a
// typo'd or stale error code is a type error, not a silent runtime string.
export type ErrorMessageCode = {
  [Domain in keyof ErrorMessagesShape]: `${Domain & string}.${Extract<keyof ErrorMessagesShape[Domain], string>}`;
}[keyof ErrorMessagesShape];
