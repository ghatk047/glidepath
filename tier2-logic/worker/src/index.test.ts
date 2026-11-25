import { describe, expect, it } from 'vitest';
import { packageName } from './index';

describe('worker', () => {
  it('exports its package name', () => {
    expect(packageName).toBe('@glidepath/worker');
  });
});
