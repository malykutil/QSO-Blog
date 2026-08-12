"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { getSupabaseBrowserClient } from "@/src/lib/supabase";

export function BlogEditButton({ postId, createdBy }: { postId?: string; createdBy?: string | null }) {
  const [canEdit, setCanEdit] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !postId || !createdBy) return;

    let mounted = true;
    void supabase.auth.getUser().then(({ data: { user } }) => {
      if (mounted) setCanEdit(user?.id === createdBy);
    });

    return () => {
      mounted = false;
    };
  }, [createdBy, postId]);

  if (!canEdit || !postId) return null;

  return (
    <Link
      href={`/blog?edit=${encodeURIComponent(postId)}#blog-editor`}
      className="mt-5 inline-flex rounded-full border border-white/20 bg-white/10 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/20"
    >
      Upravit článek
    </Link>
  );
}
