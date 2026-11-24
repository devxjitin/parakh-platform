// Exam integrity helpers for device and network flags.

// ------------------------------------------------------------------- limits

export const INTEGRITY = {
  /** Device ids are random strings made by the browser; anything outside this is rejected. */
  DEVICE_ID_PATTERN: /^[A-Za-z0-9_-]{16,64}$/,
  /** Wrong exam codes one student may try in the window below before being paused. */
  JOIN_MISS_LIMIT: 8,
  JOIN_MISS_WINDOW_MS: 10 * 60_000,
  /** Shorter programs than this (in tokens) are too small to compare fairly. */
  MIN_TOKENS: 30,
  /** Most answers compared per question, to keep the report quick. */
  MAX_COMPARED: 600,
} as const;

// -------------------------------------------------------------------- flags

export type IntegrityFlagCode =
  'SHARED_DEVICE' | 'DEVICE_MISMATCH' | 'NETWORK_CHANGED' | 'NO_DEVICE_ID';

export interface IntegrityFlag {
  code: IntegrityFlagCode;
  /** Plain-language line for the trainer. */
  message: string;
}

export interface IntegrityDto {
  startIp: string | null;
  lastIp: string | null;
  userAgent: string | null;
  hasDeviceId: boolean;
  /** Other students in this exam who used the same device. */
  sharedWith: { name: string; email: string }[];
  flags: IntegrityFlag[];
}

export const FLAG_TEXT: Record<IntegrityFlagCode, string> = {
  SHARED_DEVICE: 'The same device was used by more than one student',
  DEVICE_MISMATCH: 'Another device tried to continue this attempt (blocked)',
  NETWORK_CHANGED: 'The network address changed during the exam',
  NO_DEVICE_ID: 'The browser did not identify its device',
};

/**
 * Turns what the server recorded into flags. These are signals for a human to look at, not
 * proof: classrooms share networks, phones change networks, and browsers can be reset.
 */
export function integrityFlags(input: {
  hasDeviceId: boolean;
  sharedDeviceCount: number;
  mismatchEvents: number;
  startIp: string | null;
  lastIp: string | null;
}): IntegrityFlag[] {
  const codes: IntegrityFlagCode[] = [];
  if (input.sharedDeviceCount > 0) codes.push('SHARED_DEVICE');
  if (input.mismatchEvents > 0) codes.push('DEVICE_MISMATCH');
  if (input.startIp && input.lastIp && input.startIp !== input.lastIp)
    codes.push('NETWORK_CHANGED');
  if (!input.hasDeviceId) codes.push('NO_DEVICE_ID');
  return codes.map((code) => ({ code, message: FLAG_TEXT[code] }));
}
