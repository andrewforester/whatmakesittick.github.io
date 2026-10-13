import { expect, test } from '@playwright/test';
import { pausePlayback } from '../driver.ts';
import { discoverExplainers } from '../site.ts';

const OUT = process.env.QA_OUT ?? '';
const ONLY = process.env.SLUG;
const SCENE_CANVAS = '#scene canvas';
const SETTLE_MS = 2_500;

test.beforeAll(() => {
  if (!OUT) throw new Error('set QA_OUT');
});

for (const { slug } of discoverExplainers()) {
  if (ONLY && ONLY !== slug) continue;
  test(`${slug} previews in AR`, async ({ page }) => {
    await page.goto(`/${slug}/?ar-preview`, { waitUntil: 'networkidle' });
    await expect(page.locator(SCENE_CANVAS).first()).toBeAttached();
    await pausePlayback(page);
    await page.waitForTimeout(SETTLE_MS);
    await page.screenshot({ path: `${OUT}/${slug}.png` });
  });
}
