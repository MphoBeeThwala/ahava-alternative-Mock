import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Fraunces } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "../contexts/AuthContext";
import { ToastProvider } from "../contexts/ToastContext";
import { ServiceWorkerRegistration } from "../components/ServiceWorkerRegistration";
import { StepUpProvider } from "../components/StepUpProvider";

const plusJakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

// Serif for the wordmark and headlines: warmer than the sans used for the UI.
const fraunces = Fraunces({
  variable: "--font-serif",
  subsets: ["latin"],
  display: "swap",
  weight: ["500", "600"],
});

export const metadata: Metadata = {
  title: "Ahava Healthcare",
  description: "Check your symptoms with AI, reviewed by a clinician. Closed beta.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Ahava",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#FBF7F0",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${plusJakarta.variable} ${fraunces.variable} font-sans antialiased`}>
        <ServiceWorkerRegistration />
        <AuthProvider>
          <ToastProvider>
            <StepUpProvider>{children}</StepUpProvider>
          </ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
