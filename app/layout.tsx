import type { Metadata } from "next";
import { Manrope, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "WillTalk | Suporte WhatsApp",
  description: "Plataforma profissional de atendimento e triagem via WhatsApp",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className={`${manrope.variable} ${plexMono.variable}`}>{children}</body>
    </html>
  );
}

