import { describe, expect, it } from 'vitest';
import { packageName } from './index';

describe('data-access', () => {
  it('exports its package name', () => {
    expect(packageName).toBe('@glidepath/data-access');
  });
});
