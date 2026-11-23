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
  themeColor: "#1e293b",
};

export const metadata: Metadata = {
  title: "WeaveSync SCADA | Ali Haider Industries",
  description: "Real-time IIoT SCADA Digital Twin for 36 Picanol Air-Jet Weaving Looms in SITE Area, Karachi",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className={`${inter.className} h-full antialiased bg-[#e8ebf0] text-slate-900 overflow-x-hidden selection:bg-blue-500/20`}>
        <TelemetryProvider>
          <div className="min-h-screen flex flex-col bg-[#e8ebf0]">
            <Header />
            <main className="flex-1 flex flex-col overflow-hidden">
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
