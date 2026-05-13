import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const strictMode = process.env.BROWSER_VISUAL_SMOKE === 'required';
const availability = {
  playwright: canResolve('playwright'),
  puppeteer: canResolve('puppeteer'),
  browserPlugin: detectBrowserPlugin(),
};

test('browser visual smoke automation availability is explicit', t => {
  const nodeBrowserRunnerAvailable = availability.playwright.available || availability.puppeteer.available;

  t.diagnostic(`Playwright: ${formatResult(availability.playwright)}`);
  t.diagnostic(`Puppeteer: ${formatResult(availability.puppeteer)}`);
  t.diagnostic(`Codex browser plugin: ${formatResult(availability.browserPlugin)}`);

  if (strictMode) {
    assert.ok(
      nodeBrowserRunnerAvailable,
      'BROWSER_VISUAL_SMOKE=required needs Playwright or Puppeteer installed for automated node --test browser smoke.',
    );
  }

  assert.equal(typeof availability.playwright.available, 'boolean');
  assert.equal(typeof availability.puppeteer.available, 'boolean');
  assert.equal(typeof availability.browserPlugin.available, 'boolean');
});

test('browser-backed mobile visual smoke harness', {
  skip: browserHarnessSkipReason(),
}, async () => {
  if (availability.playwright.available) {
    const { chromium, devices } = await import('playwright');
    const browser = await chromium.launch();
    try {
      const context = await browser.newContext({
        ...(devices['iPhone 13'] ?? {}),
        viewport: { width: 390, height: 844 },
      });
      const page = await context.newPage();
      await page.setContent('<main><h1>Midway</h1><button>Book now</button></main>');
      await assert.doesNotReject(() => page.locator('h1').waitFor());
    } finally {
      await browser.close();
    }
    return;
  }

  if (availability.puppeteer.available) {
    const puppeteer = await import('puppeteer');
    const browser = await puppeteer.launch();
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 390, height: 844, isMobile: true });
      await page.setContent('<main><h1>Midway</h1><button>Book now</button></main>');
      assert.equal(await page.$eval('h1', node => node.textContent), 'Midway');
    } finally {
      await browser.close();
    }
  }
});

function canResolve(packageName) {
  try {
    return {
      available: true,
      detail: require.resolve(packageName),
    };
  } catch (error) {
    return {
      available: false,
      detail: error.code === 'MODULE_NOT_FOUND'
        ? `${packageName} is not installed`
        : error.message,
    };
  }
}

function detectBrowserPlugin() {
  const exposed = process.env.CODEX_BROWSER_PLUGIN
    || process.env.BROWSER_PLUGIN_AVAILABLE
    || process.env.BROWSER_USE_AVAILABLE;

  if (exposed) {
    return {
      available: /^(1|true|yes)$/i.test(exposed),
      detail: 'detected from environment',
    };
  }

  return {
    available: false,
    detail: 'not exposed to Node test runtime; use the Codex Browser plugin manually or install Playwright/Puppeteer for CI',
  };
}

function browserHarnessSkipReason() {
  if (availability.playwright.available || availability.puppeteer.available) {
    return false;
  }

  if (availability.browserPlugin.available) {
    return 'Codex Browser plugin is available interactively but is not callable from node --test; install Playwright or Puppeteer for automated CI smoke.';
  }

  return 'No browser automation runtime detected. Install Playwright/Puppeteer, or run with BROWSER_VISUAL_SMOKE=required to make missing automation fail CI.';
}

function formatResult(result) {
  return `${result.available ? 'available' : 'unavailable'} (${result.detail})`;
}
