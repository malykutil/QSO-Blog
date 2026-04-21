"use client";

import Image, { type ImageLoaderProps } from "next/image";

const passthroughLoader = ({ src }: ImageLoaderProps) => src;

export function BlogImage({
  src,
  alt,
  sizes = "100vw",
  priority = false,
  className = "object-cover",
}: {
  src: string;
  alt: string;
  sizes?: string;
  priority?: boolean;
  className?: string;
}) {
  return (
    <Image
      src={src}
      alt={alt}
      fill
      unoptimized
      loader={passthroughLoader}
      sizes={sizes}
      priority={priority}
      className={className}
    />
  );
}
