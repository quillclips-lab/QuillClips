import type { Metadata } from "next";
import { Archivo, JetBrains_Mono } from "next/font/google";
import { Suspense } from "react";
import Sidebar from "@/components/Sidebar";
import "./globals.css";

const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin", "latin-ext"],
  axes: ["wdth"],
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin", "latin-ext"],
});

export const metadata: Metadata = {
  title: "QuillClips",
  description: "Lokal kişisel clipping stüdyosu",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr" className={`${archivo.variable} ${jetbrains.variable} h-full`}>
      <body className="min-h-full bg-ink text-fg">
        <div className="flex min-h-screen flex-col md:flex-row">
          <Suspense fallback={<div className="w-full shrink-0 border-b border-line md:h-screen md:w-[232px] md:border-b-0 md:border-r" />}>
            <Sidebar />
          </Suspense>
          <main className="min-w-0 flex-1 px-5 pb-16 pt-8 md:px-10 md:pt-10">
            <div className="mx-auto max-w-[1440px]">{children}</div>
          </main>
        </div>
      </body>
    </html>
  );
}
