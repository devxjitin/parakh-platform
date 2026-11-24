import Link from 'next/link';

export function Brand() {
  return (
    <Link href="/" className="brand">
      <span className="brand-mark">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/nandivex-logo.png" alt="NandiVex Technologies" width={34} height={34} />
      </span>
      <span className="brand-text">
        <b>
          Par<span>akh</span>
        </b>
        <small>NandiVex Technologies</small>
      </span>
    </Link>
  );
}
