import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Agent Casino",
  description: "Public feed of agent gambling experiments",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
