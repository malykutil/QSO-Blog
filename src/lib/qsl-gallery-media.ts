import type { SupabaseClient } from "@supabase/supabase-js";

export const QSL_CARD_BUCKET = "qsl-cards";
const MAX_QSL_CARD_SIZE = 8 * 1024 * 1024;
const allowedImageTypes = new Set(["image/png", "image/jpeg", "image/webp"]);

function safeFileName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function validateQslCardImage(file: File) {
  if (!allowedImageTypes.has(file.type)) {
    return "Vyber PNG, JPG nebo WEBP obrázek QSL lístku.";
  }

  if (file.size > MAX_QSL_CARD_SIZE) {
    return "QSL lístek může mít maximálně 8 MB.";
  }

  return null;
}

export async function uploadQslCardImage({
  supabase,
  userId,
  file,
}: {
  supabase: SupabaseClient;
  userId: string;
  file: File;
}) {
  const validationError = validateQslCardImage(file);
  if (validationError) {
    throw new Error(validationError);
  }

  const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const baseName = safeFileName(file.name.replace(/\.[^.]+$/, "")) || "qsl-listek";
  const path = `${userId}/${Date.now()}-${crypto.randomUUID()}-${baseName}.${extension}`;
  const { error } = await supabase.storage.from(QSL_CARD_BUCKET).upload(path, file, {
    cacheControl: "3600",
    contentType: file.type,
    upsert: false,
  });

  if (error) {
    throw new Error(error.message);
  }

  const { data } = supabase.storage.from(QSL_CARD_BUCKET).getPublicUrl(path);
  return { imageUrl: data.publicUrl, path };
}
