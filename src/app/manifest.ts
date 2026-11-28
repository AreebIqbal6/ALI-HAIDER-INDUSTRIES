import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "WeaveSync SCADA | Ali Haider Industries",
    short_name: "WeaveSync",
    description:
      "Real-time IIoT SCADA telemetry and OEE monitoring for Picanol Air-Jet weaving looms.",
    start_url: "/",
    display: "standalone",
    background_color: "#e8ebf0",
    theme_color: "#1e293b",
    icons: [
      {
        src: "/logo.png",
        sizes: "any",
        type: "image/png",
      },
    ],
  };
}
