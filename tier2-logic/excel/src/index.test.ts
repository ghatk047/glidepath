import { describe, expect, it } from 'vitest';
import { packageName } from './index';

describe('excel', () => {
  it('exports its package name', () => {
    expect(packageName).toBe('@glidepath/excel');
  });
});
