/**
 * Simple Screenshot Script for YggTorrent Helper Extension
 * Takes screenshots of mock HTML files at extension popup size (350px)
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const OUTPUT_DIR = path.resolve(__dirname, 'output');
const IMAGES_DIR = path.resolve(__dirname, '..', 'images');

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

async function takeScreenshots() {
  console.log('🎬 Taking screenshots of mock HTML files...');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 350, height: 600 },
    deviceScaleFactor: 2 // High DPI for crisp screenshots
  });

  try {
    // Read mock HTML files
    const pipelineHtml = fs.readFileSync(path.join(__dirname, 'mock-pipeline.html'), 'utf8');
    const updateHtml = fs.readFileSync(path.join(__dirname, 'mock-update.html'), 'utf8');

    // Take pipeline screenshot
    console.log('📸 Taking pipeline screenshot...');
    const pipelinePage = await context.newPage();
    await pipelinePage.setContent(pipelineHtml, { waitUntil: 'networkidle' });

    // Wait for fonts to load
    await pipelinePage.waitForTimeout(500);

    // Take screenshot of the content area only (no white space)
    await pipelinePage.screenshot({
      path: path.join(OUTPUT_DIR, 'page_principal.png'),
      fullPage: true
    });
    console.log('   ✅ Saved: output/page_principal.png');
    await pipelinePage.close();

    // Take update notification screenshot
    console.log('📸 Taking update notification screenshot...');
    const updatePage = await context.newPage();
    await updatePage.setContent(updateHtml, { waitUntil: 'networkidle' });
    await updatePage.waitForTimeout(500);

    await updatePage.screenshot({
      path: path.join(OUTPUT_DIR, 'update_notif.png'),
      fullPage: true
    });
    console.log('   ✅ Saved: output/update_notif.png');
    await updatePage.close();

    // Copy to images folder
    console.log('\n📁 Copying to images folder...');
    fs.copyFileSync(
      path.join(OUTPUT_DIR, 'page_principal.png'),
      path.join(IMAGES_DIR, 'page_principal.png')
    );
    fs.copyFileSync(
      path.join(OUTPUT_DIR, 'update_notif.png'),
      path.join(IMAGES_DIR, 'update_notif.png')
    );
    console.log('   ✅ Copied to images/');

    console.log('\n🎉 Screenshots complete!');
    console.log(`   Output: ${OUTPUT_DIR}`);
    console.log(`   Images: ${IMAGES_DIR}`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    throw error;
  } finally {
    await browser.close();
  }
}

takeScreenshots().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
