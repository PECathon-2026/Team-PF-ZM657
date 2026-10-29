// Page title for /radar. Runs on the SERVER (metadata only, no data).
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Personal Knowledge Radar · NOVA Reader",
  description: "A private summary of your saved articles, computed in your browser.",
};

export default function RadarLayout({ children }: { children: React.ReactNode }) {
  return children;
}
