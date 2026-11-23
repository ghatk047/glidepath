import { describe, expect, it } from 'vitest';
import { packageName } from './index';

describe('tier-check', () => {
  it('exports its package name', () => {
    expect(packageName).toBe('@glidepath/tier-check');
  });
});
