import { describe, expect, it } from 'vitest';
import { packageName } from './index';

describe('gen-schema', () => {
  it('exports its package name', () => {
    expect(packageName).toBe('@glidepath/gen-schema');
  });
});
