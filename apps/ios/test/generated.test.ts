import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderAll, swiftCase } from '../scripts/render';

/**
 * A generált iOS-fájlok frissessége: ha a dizájn-token, a szótár vagy a webes szimulátor változik,
 * ez bukik, amíg nem fut le az `npm run generate -w @atlagsebesseg/ios`.
 */
describe('iOS generált fájlok', () => {
  const root = join(__dirname, '..');
  for (const [rel, content] of renderAll()) {
    it(`${rel} friss`, () => {
      expect(readFileSync(join(root, rel), 'utf8')).toBe(content);
    });
  }
  it('Swift-kulcsnév', () => {
    expect(swiftCase('hud.manual.stopTemp')).toBe('hudManualStopTemp');
    expect(swiftCase('camera.type.red_light')).toBe('cameraTypeRedLight');
    expect(swiftCase('warn.camera.DE')).toBe('warnCameraDE');
  });
});
