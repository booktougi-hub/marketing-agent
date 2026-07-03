"use client";

import {
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Upload, X } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import type { ProductType } from "@/types";

const PRODUCT_TYPE_OPTIONS: { value: ProductType; label: string }[] = [
  { value: "developer_tool", label: "Developer Tool" },
  { value: "mobile_app", label: "Mobile App" },
  { value: "web_app", label: "Web App" },
  { value: "saas", label: "SaaS Product" },
  { value: "browser_extension", label: "Browser Extension" },
  { value: "other", label: "Other" },
];

const MAX_FILES = 3;
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_EXTENSIONS = [".pdf", ".docx", ".txt", ".md"];

const urlSchema = z
  .string()
  .trim()
  .min(1, "App URL is required.")
  .url("Enter a valid URL, like https://yourapp.com.");

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function NewAppPage() {
  const router = useRouter();

  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [productType, setProductType] = useState<ProductType | null>(null);
  const [additionalContext, setAdditionalContext] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addFiles(newFiles: FileList | File[]) {
    setFileError(null);
    const incoming = Array.from(newFiles);

    const oversized = incoming.find((file) => file.size > MAX_FILE_SIZE_BYTES);
    if (oversized) {
      setFileError(`File ${oversized.name} exceeds 10MB limit`);
      return;
    }

    setFiles((current) => {
      const combined = [...current, ...incoming];
      if (combined.length > MAX_FILES) {
        setFileError("Maximum 3 files allowed");
        return current;
      }
      return combined;
    });
  }

  function handleFileInputChange(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(e.target.files);
    }
    e.target.value = "";
  }

  function handleDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  }

  function removeFile(index: number) {
    setFileError(null);
    setFiles((current) => current.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const urlResult = urlSchema.safeParse(url);
    if (!urlResult.success) {
      setUrlError(urlResult.error.issues[0]?.message ?? "Enter a valid URL.");
      return;
    }
    setUrlError(null);

    setSubmitting(true);

    const formData = new FormData();
    formData.append("url", urlResult.data);
    formData.append("product_type", productType ?? "");
    formData.append("additional_context", additionalContext);
    files.forEach((file) => formData.append("docs", file));

    try {
      const response = await fetch("/api/apps", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        let message = "Failed to create app.";
        try {
          const parsed = (await response.json()) as { error?: string };
          if (parsed.error) message = parsed.error;
        } catch {
          // response wasn't JSON, fall back to default message
        }
        throw new Error(message);
      }

      const data = (await response.json()) as { id: string };
      router.push(`/dashboard/apps/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create app.");
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-[600px] flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link
          href="/dashboard/apps"
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to apps
        </Link>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Add your app
          </h1>
          <p className="text-sm text-muted-foreground">
            Paste your app URL and we will handle everything else
          </p>
        </div>
      </div>

      <Card className="[--card-spacing:--spacing(8)]">
        <CardContent>
          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="url">App URL</Label>
              <Input
                id="url"
                type="text"
                inputMode="url"
                className="w-full"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  if (urlError) setUrlError(null);
                }}
                placeholder="https://yourapp.com"
                aria-invalid={!!urlError}
              />
              {urlError && (
                <p role="alert" className="text-sm text-destructive">
                  {urlError}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="product-type">
                What type of product is this?
              </Label>
              <Select
                items={PRODUCT_TYPE_OPTIONS}
                value={productType}
                onValueChange={(value) => setProductType(value)}
              >
                <SelectTrigger id="product-type" className="w-full">
                  <SelectValue placeholder="Select a type" />
                </SelectTrigger>
                <SelectContent>
                  {PRODUCT_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="additional-context">
                Tell us more about your app
              </Label>
              <p className="text-xs text-muted-foreground">
                Describe what your app does, the problem it solves, who it is
                for, and what makes it different. The more detail you
                provide, the better your marketing strategy will be.
              </p>
              <Textarea
                id="additional-context"
                rows={6}
                value={additionalContext}
                onChange={(e) => setAdditionalContext(e.target.value)}
                placeholder="Example: My app helps solo developers automate their social media marketing. The main problem it solves is that developers ship great products but have no time to market them..."
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="docs">Upload supporting documents</Label>
              <p className="text-xs text-muted-foreground">
                Upload pitch decks, feature specs, or any docs that describe
                your app. Accepted: PDF, Word (.docx), TXT, Markdown. Max
                10MB per file. Up to 3 files.
              </p>

              <label
                htmlFor="docs"
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-gray-300 px-4 py-8 text-center transition-colors hover:bg-muted/50"
              >
                <Upload className="size-6 text-muted-foreground" />
                <p className="text-sm text-foreground">
                  Drag and drop files here
                </p>
                <p className="text-xs text-muted-foreground">
                  or click to browse
                </p>
                <div className="flex flex-wrap items-center justify-center gap-1.5">
                  {ACCEPTED_EXTENSIONS.map((ext) => (
                    <span
                      key={ext}
                      className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
                    >
                      {ext.replace(".", "").toUpperCase()}
                    </span>
                  ))}
                </div>
                <input
                  id="docs"
                  type="file"
                  multiple
                  accept={ACCEPTED_EXTENSIONS.join(",")}
                  onChange={handleFileInputChange}
                  className="sr-only"
                />
              </label>

              {fileError && (
                <p role="alert" className="text-sm text-destructive">
                  {fileError}
                </p>
              )}

              {files.length > 0 && (
                <ul className="flex flex-col gap-2">
                  {files.map((file, index) => (
                    <li
                      key={`${file.name}-${index}`}
                      className="flex items-center justify-between gap-2 rounded-lg border border-input px-2.5 py-2"
                    >
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate text-sm font-medium">
                          {file.name}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatFileSize(file.size)}
                        </span>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove ${file.name}`}
                        onClick={() => removeFile(index)}
                      >
                        <X />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting && <Loader2 className="animate-spin" />}
                {submitting ? "Analysing your app..." : "Start Marketing"}
              </Button>

              {error && (
                <p
                  role="alert"
                  className="rounded-lg bg-destructive/10 px-2.5 py-2 text-sm text-destructive"
                >
                  {error}
                </p>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
