import type { Metadata } from "next";
import { Noto_Sans_Thai } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const notoSansThai = Noto_Sans_Thai({
  variable: "--font-sans",
  subsets: ["thai", "latin"],
});

export const instant = false;

export const metadata: Metadata = {
  title: "OCR Playground",
  description: "Run OCR engines on the same document and compare their output",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="th" className={notoSansThai.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
