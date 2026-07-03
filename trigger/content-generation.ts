import { logger, schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";

const payloadSchema = z.object({
  app_id: z.string(),
  workspace_id: z.string(),
});

export const contentGeneration = schemaTask({
  id: "content-generation",
  schema: payloadSchema,
  run: async (payload) => {
    logger.warn("content-generation is not implemented yet", payload);
    throw new Error("content-generation is not implemented yet.");
  },
});
