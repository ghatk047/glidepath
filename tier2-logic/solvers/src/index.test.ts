import { describe, expect, it } from 'vitest';
import { packageName } from './index';

describe('solvers', () => {
  it('exports its package name', () => {
    expect(packageName).toBe('@glidepath/solvers');
  });
});
