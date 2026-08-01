import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "OK2KZB Solární dohled",
    short_name: "OK2KZB",
    description: "Mobilní ovládání relé a přehled solární stanice.",
    start_url: "/solar",
    display: "standalone",
    background_color: "#f5f8fb",
    theme_color: "#10251c",
    lang: "cs",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}
