import { describe, expect, it } from 'vitest';
import { packageName } from './index';

describe('spec', () => {
  it('exports its package name', () => {
    expect(packageName).toBe('@glidepath/spec');
  });
});
