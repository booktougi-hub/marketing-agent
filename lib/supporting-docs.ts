import "server-only";
import { logger } from "@trigger.dev/sdk";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { supabaseAdmin } from "@/lib/supabase-server";

// Shared by trigger/dna-extraction.ts and trigger/dna-reextraction.ts — both
// read the same apps.doc_paths (Supabase Storage bucket 'app-docs') to fold
// uploaded supporting documents into the DNA extraction context.

function getExtension(path: string) {
  return path.split(".").pop()?.toLowerCase() ?? "";
}

export async function extractDocText(path: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.storage
    .from("app-docs")
    .download(path);

  if (error || !data) {
    logger.error("Failed to download supporting document", {
      path,
      error: error?.message,
    });
    return null;
  }

  const extension = getExtension(path);

  try {
    if (extension === "pdf") {
      const buffer = Buffer.from(await data.arrayBuffer());
      const parser = new PDFParse({ data: buffer });
      const result = await parser.getText();
      await parser.destroy();
      return result.text;
    }

    if (extension === "docx") {
      const buffer = Buffer.from(await data.arrayBuffer());
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    }

    if (extension === "txt" || extension === "md") {
      return await data.text();
    }

    logger.warn("Unsupported document type, skipping", { path, extension });
    return null;
  } catch (err) {
    logger.error("Failed to extract text from document", {
      path,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export async function extractDocTexts(docPaths: string[]): Promise<string[]> {
  const docTexts: string[] = [];
  for (const path of docPaths) {
    const text = await extractDocText(path);
    if (text?.trim()) {
      docTexts.push(text.trim());
    }
  }
  return docTexts;
}
