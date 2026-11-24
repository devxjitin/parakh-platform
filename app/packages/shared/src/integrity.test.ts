import { describe, expect, it } from 'vitest';
import { integrityFlags } from './integrity';

describe('integrityFlags', () => {
  const clean = {
    hasDeviceId: true,
    sharedDeviceCount: 0,
    mismatchEvents: 0,
    startIp: '1.1.1.1',
    lastIp: '1.1.1.1',
  };
  it('is empty for a normal attempt', () => {
    expect(integrityFlags(clean)).toEqual([]);
  });
  it('lists every signal', () => {
    const codes = integrityFlags({
      hasDeviceId: false,
      sharedDeviceCount: 1,
      mismatchEvents: 2,
      startIp: '1.1.1.1',
      lastIp: '2.2.2.2',
    }).map((f) => f.code);
    expect(codes).toEqual(['SHARED_DEVICE', 'DEVICE_MISMATCH', 'NETWORK_CHANGED', 'NO_DEVICE_ID']);
  });
});
