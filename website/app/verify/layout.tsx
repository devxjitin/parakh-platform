import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Verify a certificate",
  description:
    "Check a NandiRank certificate: enter its serial number to confirm who it was issued to and that it is genuine.",
  alternates: { canonical: "/verify/" },
};

export default function VerifyLayout({ children }: { children: ReactNode }) {
  return children;
}
