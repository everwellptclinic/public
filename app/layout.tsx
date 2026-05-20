import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Everwell PT Clinic",
  description: "LINE Bot for Everwell PT Clinic",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-TW">
      <body>{children}</body>
    </html>
  );
}
