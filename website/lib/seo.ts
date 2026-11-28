/** Where this website is served (its own address). Set NEXT_PUBLIC_SITE_URL at build time. */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://nandirank.nandivex.com"
).replace(/\/$/, "");

export const SITE_NAME = "NandiRank";
export const SITE_TITLE = "NandiRank | Online exams and verified certificates";
export const SITE_DESCRIPTION =
  "NandiRank by NandiVex Technologies: create, proctor and grade online exams, and issue certificates anyone can verify with a serial number and QR code.";
