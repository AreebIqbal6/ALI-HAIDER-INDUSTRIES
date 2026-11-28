import type { Metadata } from "next";
import { AnalyticsDashboard } from "@/views/AnalyticsDashboard";

export const metadata: Metadata = {
  title: "Shift Analytics & OEE",
  description:
    "12-hour PKT shift production metrics, equipment effectiveness (OEE), and downtime Pareto analysis for Ali Haider Industries.",
  alternates: {
    canonical: "/analytics",
  },
};

export default function AnalyticsPage() {
  return <AnalyticsDashboard />;
}
