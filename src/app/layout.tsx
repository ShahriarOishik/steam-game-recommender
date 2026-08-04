import type { Metadata } from "next";
import { Space_Grotesk } from "next/font/google";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({ variable: "--font-space-grotesk", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Spec Scout | Steam Game Finder",
  description: "Find Steam games that match your taste and PC.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return <html lang="en" className={`${spaceGrotesk.variable} h-full antialiased`}><body className="min-h-full flex flex-col">{children}</body></html>;
}
