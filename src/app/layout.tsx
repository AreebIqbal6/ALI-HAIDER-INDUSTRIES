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
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

export const metadata: Metadata = {
  title: "WeaveSync SCADA | Ali Haider Industries",
  description: "Real-time Industrial SCADA System for Picanol Air-Jet Weaving Looms at Ali Haider Industries",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className={`${inter.className} h-full antialiased bg-zinc-50 text-zinc-950 overflow-x-hidden selection:bg-zinc-200`}>
        <TelemetryProvider>
          <div className="min-h-screen flex flex-col bg-zinc-50">
            <Header />
            <main className="flex-1 flex flex-col overflow-hidden">
              <Toaster 
                position="top-right" 
                reverseOrder={false}
                toastOptions={{
                  duration: 3500,
                  style: {
                    fontSize: '12px',
                    fontWeight: 500,
                    borderRadius: '6px',
                    background: '#18181b',
                    color: '#ffffff',
                    boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                  }
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
