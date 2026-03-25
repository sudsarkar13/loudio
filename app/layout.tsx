import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@/app/styles/globals.css";

export const metadata: Metadata = {
  title: "Loudio | Offline Whisper Transcription",
  description: "Modern offline speech-to-text for macOS, powered by Whisper on Apple Silicon."
};

interface RootLayoutProps {
  children: ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
