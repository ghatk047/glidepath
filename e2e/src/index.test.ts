import { describe, expect, it } from 'vitest';
import { packageName } from './index';

describe('e2e', () => {
  it('exports its package name', () => {
    expect(packageName).toBe('@glidepath/e2e');
  });
});
