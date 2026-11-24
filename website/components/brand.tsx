import Link from "next/link";

/** Brand lockup: shield + "arakh" + tagline (the shield is the P of Parakh). */
export function Brand() {
  return (
    <Link
      href="/"
      className="brand"
      aria-label="Parakh by NandiVex Technologies"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="brand-logo"
        src="/parakh-logo.png"
        alt="Parakh by NandiVex Technologies"
      />
    </Link>
  );
}
