import { describe, expect, it } from 'vitest';
import { packageName } from './index';

describe('server', () => {
  it('exports its package name', () => {
    expect(packageName).toBe('@glidepath/server');
  });
});
