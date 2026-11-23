import { describe, expect, it } from 'vitest';
import { packageName } from './index';

describe('api-contract', () => {
  it('exports its package name', () => {
    expect(packageName).toBe('@glidepath/api-contract');
  });
});
