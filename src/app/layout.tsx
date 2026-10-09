import type { Metadata, Viewport } from "next";
import { DM_Sans, Fredoka } from "next/font/google";
import { EnvBanner } from "@/components/layout/EnvBanner";
import { ServiceWorkerRegister } from "@/components/layout/ServiceWorkerRegister";
import "./globals.css";

const fredoka = Fredoka({
  variable: "--font-fredoka",
  subsets: ["latin"],
  weight: ["600", "700"],
  display: "swap",
});

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Chegô — Pediu, Chegô.", template: "%s · Chegô" },
  description:
    "Tudo da cidade, numa sacola só. Peça das lojas de Joaquim Gomes e receba em casa.",
  applicationName: "Chegô",
  appleWebApp: { capable: true, title: "Chegô", statusBarStyle: "default" },
  icons: {
    icon: [
      { url: "/icons/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#E8611A",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      className={`${fredoka.variable} ${dmSans.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <EnvBanner />
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
