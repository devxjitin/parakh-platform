import { describe, expect, it } from 'vitest';
import { SERIAL_PATTERN } from './certificate';

describe('certificate serial numbers', () => {
  it('accepts the short serial', () => {
    expect(SERIAL_PATTERN.test('PRK-7K3P-9QX2')).toBe(true);
  });

  it('still accepts the older, longer serials so issued certificates keep verifying', () => {
    expect(SERIAL_PATTERN.test('PRK-7K3P-9QX2-ABCD')).toBe(true);
  });

  it('rejects anything else, including letters people mix up', () => {
    for (const bad of [
      'PRK-7K3P',
      'PRK-7K3P-9QX2-ABCD-EFGH',
      'prk-7k3p-9qx2-',
      'PRK-0O1I-9QX2',
      "PRK-'; DROP TABLE",
      '',
    ]) {
      expect(SERIAL_PATTERN.test(bad), bad).toBe(false);
    }
  });
});
