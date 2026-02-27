/**
 * One-off script: generate PDF from docs/Ahava_on_88_INVESTMENT_BUSINESS_PLAN.html
 * Run: node scripts/export-investment-plan-pdf.js
 * Requires: npx puppeteer (or npm install puppeteer)
 */
const path = require('path');
const fs = require('fs');

const projectRoot = path.resolve(__dirname, '..');
const htmlPath = path.join(projectRoot, 'docs', 'Ahava_on_88_INVESTMENT_BUSINESS_PLAN.html');
const pdfPath = path.join(projectRoot, 'docs', 'Ahava_on_88_INVESTMENT_BUSINESS_PLAN.pdf');

async function main() {
  if (!fs.existsSync(htmlPath)) {
    console.error('HTML file not found:', htmlPath);
    process.exit(1);
  }
  let puppeteer;
  try {
    puppeteer = require('puppeteer');
  } catch {
    console.log('Puppeteer not installed. Run: npx puppeteer scripts/export-investment-plan-pdf.js');
    console.log('Or open docs/Ahava_on_88_INVESTMENT_BUSINESS_PLAN.html in a browser and use Print > Save as PDF.');
    process.exit(1);
  }
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.goto('file://' + htmlPath.replace(/\\/g, '/'), { waitUntil: 'networkidle0' });
  await page.pdf({
    path: pdfPath,
    format: 'A4',
    printBackground: true,
    margin: { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' }
  });
  await browser.close();
  console.log('PDF saved to:', pdfPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
