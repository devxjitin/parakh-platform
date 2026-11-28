import Link from "next/link";

export function Brand() {
  return (
    <Link
      href="/"
      className="brand"
      aria-label="NandiRank by NandiVex Technologies"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="brand-logo"
        src="/parakh-logo.png"
        alt="NandiRank by NandiVex Technologies"
      />
    </Link>
  );
}
