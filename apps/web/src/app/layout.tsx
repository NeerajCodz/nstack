import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./styles.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Connect Linear to nstack",
  description: "Authorize nstack to access Linear through your configured service."
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
