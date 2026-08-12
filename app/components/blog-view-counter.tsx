"use client";

import { useEffect, useState } from "react";

function formatViews(count: number) {
  return new Intl.NumberFormat("cs-CZ").format(count);
}

export function BlogViewCounter({ slug, initialCount }: { slug: string; initialCount: number }) {
  const [count, setCount] = useState(initialCount);

  useEffect(() => {
    const storageKey = `blog-viewed:${slug}`;
    if (window.sessionStorage.getItem(storageKey)) return;
    window.sessionStorage.setItem(storageKey, "1");

    const registerView = async () => {
      try {
        const response = await fetch(`/api/blog/${encodeURIComponent(slug)}/view`, { method: "POST" });
        if (!response.ok) throw new Error("view-counter");
        const result = await response.json() as { viewCount?: number };
        if (typeof result.viewCount === "number") setCount(result.viewCount);
      } catch {
        window.sessionStorage.removeItem(storageKey);
      }
    };

    void registerView();
  }, [slug]);

  return <span aria-label={`Počet zobrazení: ${count}`}>{formatViews(count)} zobrazení</span>;
}
