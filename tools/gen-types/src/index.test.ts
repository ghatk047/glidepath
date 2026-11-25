import { describe, expect, it } from 'vitest';
import { packageName } from './index';

describe('gen-types', () => {
  it('exports its package name', () => {
    expect(packageName).toBe('@glidepath/gen-types');
  });
});
