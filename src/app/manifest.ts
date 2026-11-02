import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Chaperone",
    short_name: "Chaperone",
    description: "Your agent shops. Chaperone holds the money.",
    start_url: "/",
    display: "standalone",
    background_color: "#ECE9E3",
    theme_color: "#121211",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
