import type { Metadata } from "next";
import { ThemeBootstrap } from "@/components/ThemeBootstrap";
import "./globals.css";

export const metadata: Metadata = {
  title: "项目管理",
  description: "简洁高效的项目管理系统",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <ThemeBootstrap />
        {children}
      </body>
    </html>
  );
}
