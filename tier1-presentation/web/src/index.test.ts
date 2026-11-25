import { describe, expect, it } from 'vitest';
import { packageName } from './index';

describe('web', () => {
  it('exports its package name', () => {
    expect(packageName).toBe('@glidepath/web');
  });
});
