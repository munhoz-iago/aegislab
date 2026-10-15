import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/styles.css', 'utf8');

function token(name: string): string {
  const root = css.match(/:root\s*\{([^}]+)\}/)?.[1] ?? '';
  const value = root.match(new RegExp(`--${name}:\\s*(#[a-fA-F0-9]{6})`))?.[1];
  if (!value) throw new Error(`Missing color token: ${name}`);
  return value;
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255);
  const linear = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function contrast(first: string, second: string): number {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe('dashboard color contrast', () => {
  it('keeps muted text and topbar app name readable', () => {
    expect(contrast(token('text-muted'), token('bg'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('topbar-app-name'), token('topbar-bg'))).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps input boundaries visible against their field surface', () => {
    expect(contrast(token('border-input'), token('field-bg'))).toBeGreaterThanOrEqual(3);
  });
});
