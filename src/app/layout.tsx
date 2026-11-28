import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { TelemetryProvider } from "@/contexts/TelemetryContext";
import { Header } from "@/components/Header";
import { Toaster } from "react-hot-toast";

const inter = Inter({ subsets: ["latin"] });

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#1e293b",
};

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://ali-haider-industries.vercel.app");

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "WeaveSync SCADA | Ali Haider Industries",
    template: "%s | WeaveSync SCADA",
  },
  description:
    "Real-time IIoT SCADA telemetry and OEE monitoring for Picanol Air-Jet weaving looms in SITE Area, Karachi.",
  openGraph: {
    title: "WeaveSync SCADA | Ali Haider Industries",
    description:
      "Real-time IIoT SCADA telemetry and OEE monitoring for Picanol Air-Jet weaving looms in SITE Area, Karachi.",
    type: "website",
    siteName: "WeaveSync SCADA",
  },
  twitter: {
    card: "summary",
    title: "WeaveSync SCADA | Ali Haider Industries",
    description:
      "Real-time IIoT SCADA telemetry and OEE monitoring for Picanol Air-Jet weaving looms in SITE Area, Karachi.",
  },
  alternates: {
    canonical: "/",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className={`${inter.className} h-full antialiased bg-[#e8ebf0] text-slate-900 overflow-x-hidden selection:bg-blue-500/20`}>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-2 focus:rounded-lg focus:bg-slate-900 focus:text-white focus:text-xs focus:font-semibold focus:shadow-lg"
        >
          Skip to main content
        </a>
        <TelemetryProvider>
          <div className="min-h-screen flex flex-col bg-[#e8ebf0]">
            <Header />
            <main id="main-content" className="flex-1 flex flex-col overflow-hidden">
              <Toaster
                position="top-right"
                reverseOrder={false}
                toastOptions={{
                  duration: 3500,
                  style: {
                    fontSize: '12px',
                    fontWeight: 600,
                    borderRadius: '10px',
                    background: '#1e293b',
                    color: '#f8fafc',
                  },
                }}
              />
              {children}
            </main>
          </div>
        </TelemetryProvider>
      </body>
    </html>
  );
}
