/**
 * One-off script: generate PDF from docs/Ahava_on_88_INVESTMENT_BUSINESS_PLAN.html
 * Run: node scripts/export-investment-plan-pdf.js
 *
 * Uses Playwright's Chromium (already a dev dependency for the E2E suite;
 * `pnpm exec playwright install chromium` once if no browser is installed).
 * Previously used puppeteer, removed 2026-09-28: its Chrome downloader pulls
 * in extract-zip, which has unpatched path-traversal advisories.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const htmlPath = path.join(projectRoot, 'docs', 'Ahava_on_88_INVESTMENT_BUSINESS_PLAN.html');
const pdfPath = path.join(projectRoot, 'docs', 'Ahava_on_88_INVESTMENT_BUSINESS_PLAN.pdf');

async function main() {
  if (!fs.existsSync(htmlPath)) {
    console.error('HTML file not found:', htmlPath);
    process.exit(1);
  }
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch(
    process.env.E2E_CHROMIUM_PATH ? { executablePath: process.env.E2E_CHROMIUM_PATH } : {},
  );
  const page = await browser.newPage();
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle' });
  await page.pdf({
    path: pdfPath,
    format: 'A4',
    printBackground: true,
    margin: { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' },
  });
  await browser.close();
  console.log('PDF saved to:', pdfPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
