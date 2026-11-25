import type { Metadata } from "next";
import { Noto_Sans_Thai } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const notoSansThai = Noto_Sans_Thai({
  variable: "--font-noto-sans-thai",
  subsets: ["thai", "latin"],
});

export const instant = false;

export const metadata: Metadata = {
  title: "OCR Playground",
  description: "Run OCR engines on the same document and compare their output",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`dark ${notoSansThai.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
