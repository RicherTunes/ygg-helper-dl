/**
 * Screenshot Capture Script for YggTorrent Helper Extension
 *
 * This script uses Playwright to load the extension and capture screenshots
 * of the popup UI in various states (empty, pipeline with items, completed, etc.)
 *
 * Prerequisites:
 *   npm install playwright
 *   npx playwright install chromium
 *
 * Usage:
 *   node capture-screenshots.js
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

// Path to extension (parent directory of this script)
const EXTENSION_PATH = path.resolve(__dirname, '..').replace(/\\/g, '/');
const OUTPUT_DIR = path.resolve(__dirname, 'output');

console.log('Debug: EXTENSION_PATH =', EXTENSION_PATH);

// Sample torrent data for mock states
const SAMPLE_TORRENTS = {
  queued: {
    '12345': {
      status: 'queued',
      name: 'Big.Buck.Bunny.2024.FRENCH.1080p.BluRay.x264-AiRLiNE',
      origin: 'https://yggtorrent.org',
      enqueuedAt: Date.now(),
      statusSince: Date.now()
    }
  },
  requesting: {
    '12346': {
      status: 'requesting',
      name: 'The.Matrix.1999.FRENCH.4K.UHD.BluRay.x264-SECRET',
      origin: 'https://yggtorrent.org',
      enqueuedAt: Date.now() - 5000,
      statusSince: Date.now(),
      requestNonce: 'abc123'
    }
  },
  counting: {
    '12347': {
      status: 'counting',
      name: 'Interstellar.2014.FRENCH.2160p.UHD.BluRay.x264-ULTRAHD',
      origin: 'https://yggtorrent.org',
      enqueuedAt: Date.now() - 10000,
      statusSince: Date.now(),
      countdownEndsAt: Date.now() + 25000, // 25 seconds remaining
      token: 'sample-token-xyz'
    }
  },
  downloading: {
    '12348': {
      status: 'downloading',
      name: 'Inception.2010.FRENCH.1080p.BluRay.x264-SPARK',
      origin: 'https://yggtorrent.org',
      enqueuedAt: Date.now() - 45000,
      statusSince: Date.now(),
      downloadId: 1
    }
  },
  done: {
    '12349': {
      status: 'done',
      name: 'Avatar.2009.FRENCH.2160p.UHD.BluRay.x264-FUTURE',
      origin: 'https://yggtorrent.org',
      enqueuedAt: Date.now() - 120000,
      statusSince: Date.now(),
      completedAt: Date.now(),
      downloadId: 2,
      justCompleted: true
    }
  },
  error: {
    '12350': {
      status: 'error',
      name: 'Dune.Part.Two.2024.FRENCH.1080p.WEB-DL.x264-NOGRP',
      origin: 'https://yggtorrent.org',
      enqueuedAt: Date.now() - 180000,
      statusSince: Date.now(),
      lastError: 'Rate limit détecté',
      errorType: 'rate_limit',
      retryCount: 2,
      nextRetryAt: Date.now() + 60000
    }
  },
  cancelled: {
    '12351': {
      status: 'cancelled',
      name: 'Oppenheimer.2023.FRENCH.IMAX.2160p.UHD.BluRay.x264-ATOM',
      origin: 'https://yggtorrent.org',
      enqueuedAt: Date.now() - 300000,
      statusSince: Date.now()
    }
  }
};

// Pipeline states for different scenarios
const SCENARIOS = {
  empty: {
    queue: [],
    timers: {},
    pipelineState: {},
    stats: 0
  },
  countdown: {
    queue: ['12347'],
    timers: SAMPLE_TORRENTS.counting,
    pipelineState: {},
    stats: 30
  },
  pipeline: {
    queue: ['12345', '12346', '12347'],
    timers: {
      ...SAMPLE_TORRENTS.queued,
      ...SAMPLE_TORRENTS.requesting,
      ...SAMPLE_TORRENTS.counting
    },
    pipelineState: {},
    stats: 90
  },
  mixed: {
    queue: ['12348', '12350'],
    timers: {
      ...SAMPLE_TORRENTS.downloading,
      ...SAMPLE_TORRENTS.error
    },
    pipelineState: {},
    stats: 180
  },
  update: {
    queue: ['12345'],
    timers: SAMPLE_TORRENTS.queued,
    pipelineState: {},
    stats: 30,
    updateAvailable: {
      version: '1.4.0',
      url: 'https://github.com/RicherTunes/ygg-helper-dl/releases/tag/v1.4.0'
    }
  }
};

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function captureScreenshots() {
  console.log('🎬 Starting screenshot capture for YggTorrent Helper');
  console.log(`📁 Extension path: ${EXTENSION_PATH}`);

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Use a temporary user data directory
  const userDataDir = path.join(OUTPUT_DIR, 'chrome-profile');

  console.log('Launching browser with extension...');

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-sandbox',
      '--disable-gpu'
    ]
  });

  let extensionId = null;

  try {
    // Wait for extension to load
    console.log('⏳ Waiting for extension to load...');
    await sleep(5000);

    // Debug: List all pages
    const pages = context.pages();
    console.log(`   Found ${pages.length} pages:`);
    for (const page of pages) {
      console.log(`   - ${page.url()}`);
    }

    // Debug: List background pages
    const backgroundPages = context.backgroundPages();
    console.log(`   Found ${backgroundPages.length} background pages:`);
    for (const bg of backgroundPages) {
      console.log(`   - BG: ${bg.url()}`);
    }

    // Try to find extension ID from background pages
    for (const bg of backgroundPages) {
      const url = bg.url();
      if (url.startsWith('chrome-extension://')) {
        const match = url.match(/chrome-extension:\/\/([a-p]{32})\//);
        if (match) {
          extensionId = match[1];
          console.log(`   Found extension ID from background: ${extensionId}`);
          break;
        }
      }
    }

    // If not found, try the extensions page
    if (!extensionId) {
      console.log('   Checking chrome://extensions...');
      const extensionsPage = await context.newPage();
      await extensionsPage.goto('chrome://extensions');

      // Wait for extensions to load
      await sleep(2000);

      // Take a screenshot for debugging
      await extensionsPage.screenshot({ path: path.join(OUTPUT_DIR, 'debug-extensions.png') });
      console.log('   Saved debug screenshot: debug-extensions.png');

      // Get page content for debugging
      const content = await extensionsPage.content();
      console.log('   Page content length:', content.length);

      // Try to get extension ID - different Chrome versions have different DOM structures
      extensionId = await extensionsPage.evaluate(() => {
        // Try modern Chrome structure
        const manager = document.querySelector('extensions-manager');
        if (manager && manager.shadowRoot) {
          const items = manager.shadowRoot.querySelectorAll('extensions-item');
          for (const item of items) {
            if (item.shadowRoot) {
              const nameElement = item.shadowRoot.querySelector('#name');
              if (nameElement && nameElement.textContent.includes('YggTorrent')) {
                return item.id;
              }
            }
          }
        }

        // Try older structure
        const items = document.querySelectorAll('extensions-item');
        for (const item of items) {
          const name = item.getAttribute('data-name') || '';
          if (name.includes('YggTorrent')) {
            return item.id;
          }
        }

        return null;
      });

      await extensionsPage.close();
    }

    // If still not found, try to find from any page URLs
    if (!extensionId) {
      for (const page of pages) {
        const url = page.url();
        if (url.includes('chrome-extension://')) {
          const match = url.match(/chrome-extension:\/\/([a-p]{32})\//);
          if (match) {
            extensionId = match[1];
            console.log(`   Found extension ID from page: ${extensionId}`);
            break;
          }
        }
      }
    }

    if (!extensionId) {
      // Generate a placeholder and try to open popup directly
      console.log('   Could not find extension ID, trying to open popup directly...');

      // List all extensions using a different approach
      const testPage = await context.newPage();

      // Try to access the extension via chrome-extension protocol
      // We'll look for it in the page list
      const allPages = context.pages();
      for (const p of allPages) {
        const url = p.url();
        console.log('   Page URL:', url);
      }

      await testPage.close();
      throw new Error('Could not find extension ID. Check if the extension path is correct.');
    }

    console.log(`✅ Extension ID: ${extensionId}`);

    // Function to set storage state and take screenshot
    const captureState = async (scenario, screenshotName, description) => {
      console.log(`📸 Capturing: ${description}...`);

      // Open popup page
      const popupUrl = `chrome-extension://${extensionId}/popup.html`;
      const page = await context.newPage();

      try {
        await page.goto(popupUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
        await sleep(500);

        // Inject storage data via evaluate
        await page.evaluate((data) => {
          return new Promise((resolve, reject) => {
            if (typeof chrome === 'undefined' || !chrome.storage) {
              reject(new Error('chrome.storage not available'));
              return;
            }

            chrome.storage.local.clear(() => {
              const items = {
                ygg_queue: data.queue,
                ygg_timers: data.timers,
                ygg_pipeline_state: data.pipelineState,
                ygg_stats_wasted: data.stats
              };

              if (data.updateAvailable) {
                items.ygg_update_available = data.updateAvailable;
              }

              chrome.storage.local.set(items, () => {
                if (chrome.runtime.lastError) {
                  reject(chrome.runtime.lastError);
                } else {
                  resolve();
                }
              });
            });
          });
        }, scenario);

        // Reload to apply storage changes
        await page.reload({ waitUntil: 'networkidle' });
        await sleep(500);

        // Take screenshot
        await page.screenshot({
          path: path.join(OUTPUT_DIR, `${screenshotName}.png`),
          fullPage: true
        });

        console.log(`   ✅ Saved: ${screenshotName}.png`);
      } finally {
        await page.close();
      }
    };

    // Capture screenshots for each scenario
    await captureState(SCENARIOS.empty, 'empty_state', 'Empty state with no torrents');
    await captureState(SCENARIOS.countdown, 'countdown', 'Countdown in progress');
    await captureState(SCENARIOS.pipeline, 'page_principal', 'Main interface with pipeline');
    await captureState(SCENARIOS.mixed, 'mixed_states', 'Mixed states (downloading + error)');
    await captureState(SCENARIOS.update, 'update_notif', 'Update notification');

    console.log('\n🎉 Screenshot capture complete!');
    console.log(`📁 Output directory: ${OUTPUT_DIR}`);

    const imagesDir = path.join(EXTENSION_PATH, 'images');
    console.log(`\n📋 To update README screenshots, copy files:`);
    console.log(`   cp "${OUTPUT_DIR}/page_principal.png" "${imagesDir}/"`);
    console.log(`   cp "${OUTPUT_DIR}/update_notif.png" "${imagesDir}/"`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    throw error;
  } finally {
    await context.close();

    // Cleanup temporary profile
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  }
}

// Run the script
captureScreenshots().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
