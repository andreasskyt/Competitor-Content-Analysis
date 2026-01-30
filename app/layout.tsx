import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "YouTube Competitor Content Analyzer",
  description: "Analyze competitor YouTube channels and get data-backed content ideas",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
