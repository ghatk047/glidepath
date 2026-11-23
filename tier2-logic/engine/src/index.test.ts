import { describe, expect, it } from 'vitest';
import { packageName } from './index';

describe('engine', () => {
  it('exports its package name', () => {
    expect(packageName).toBe('@glidepath/engine');
  });
});
