import type { SupabaseClient } from "@supabase/supabase-js";

export const BLOG_IMAGE_BUCKET = "blog-images";
const MAX_BLOG_IMAGE_SIZE = 5 * 1024 * 1024;
const allowedImageTypes = new Set(["image/png", "image/jpeg"]);

function sanitizeFileName(value: string) {
  const trimmed = value.trim().toLowerCase();
  const normalized = trimmed.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  return normalized.replace(/[^a-z0-9._-]+/g, "-").replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "");
}

export function validateBlogImageFile(file: File) {
  if (!allowedImageTypes.has(file.type)) {
    return `Soubor ${file.name} není PNG ani JPG.`;
  }

  if (file.size > MAX_BLOG_IMAGE_SIZE) {
    return `Soubor ${file.name} je větší než 5 MB.`;
  }

  return null;
}

export async function uploadBlogImageFile({
  supabase,
  userId,
  file,
  folder,
}: {
  supabase: SupabaseClient;
  userId: string;
  file: File;
  folder: string;
}) {
  const validationError = validateBlogImageFile(file);
  if (validationError) {
    throw new Error(validationError);
  }

  const extensionFromType = file.type === "image/png" ? "png" : "jpg";
  const baseName = sanitizeFileName(file.name.replace(/\.[^.]+$/, "")) || "obrazek";
  const filePath = `${userId}/${folder}/${Date.now()}-${crypto.randomUUID()}-${baseName}.${extensionFromType}`;

  const { error } = await supabase.storage.from(BLOG_IMAGE_BUCKET).upload(filePath, file, {
    cacheControl: "3600",
    contentType: file.type,
    upsert: false,
  });

  if (error) {
    throw new Error(error.message);
  }

  const { data } = supabase.storage.from(BLOG_IMAGE_BUCKET).getPublicUrl(filePath);
  return data.publicUrl;
}
