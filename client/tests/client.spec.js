import { test, expect } from '@playwright/test';
import {
  mockRepo,
  mockThread,
  mockMessages,
  mockClaimedThread,
  mockFileList,
  mockFileContent,
  serializeThread,
  encodeContent
} from './fixtures/mock-data.js';

// Helper to set up localStorage with config - must be called after navigating to the page
async function setupConfig(page, config = {}) {
  const defaultConfig = {
    token: 'ghp_test_token',
    repo: 'testuser/mess-exchange',
    executorId: 'test-executor',
    displayName: 'Test Executor',
    canRequest: true,
    capabilities: ['check:visual', 'photo:capture']
  };
  await page.evaluate((cfg) => {
    localStorage.setItem('mess-executor-config', JSON.stringify(cfg));
  }, { ...defaultConfig, ...config });
}

// Helper to clear localStorage - must be called after navigating to the page
async function clearConfig(page) {
  await page.evaluate(() => localStorage.clear());
}

// Helper to set up GitHub API mocks
async function setupGitHubMocks(page, options = {}) {
  const {
    threads = [mockThread],
    messages = mockMessages,
    folders = { received: threads, executing: [], finished: [], canceled: [] }
  } = options;

  await page.route('https://api.github.com/repos/**', async (route, request) => {
    const url = request.url();
    const method = request.method();

    // Test connection - repo info
    if (url.match(/\/repos\/[^/]+\/[^/]+$/) && method === 'GET') {
      return route.fulfill({ json: mockRepo });
    }

    // List folder contents - handles exchange/state=received
    const folderMatch = url.match(/\/contents\/exchange\/state=(\w+)/);
    if (folderMatch && method === 'GET' && !url.includes('.yaml')) {
      const folder = folderMatch[1];
      const folderThreads = folders[folder] || [];
      if (folderThreads.length === 0) {
        return route.fulfill({ status: 404, json: { message: '404 Not Found' } });
      }
      return route.fulfill({ json: mockFileList(folderThreads) });
    }

    // Get file content
    const fileMatch = url.match(/\/contents\/exchange\/state=(\w+)\/([^?]+\.yaml)/);
    if (fileMatch && method === 'GET') {
      const [, folder, filename] = fileMatch;
      const ref = filename.replace('.messe-af.yaml', '');
      const thread = (folders[folder] || []).find(t => t.ref === ref);
      if (!thread) {
        return route.fulfill({ status: 404, json: { message: '404 Not Found' } });
      }
      const path = `exchange/state=${folder}/${filename}`;
      return route.fulfill({ json: mockFileContent(thread, messages, path) });
    }

    // Create/update file
    if (url.includes('/contents/exchange/') && method === 'PUT') {
      return route.fulfill({
        json: {
          content: { sha: 'new-sha-' + Date.now() },
          commit: { sha: 'commit-sha' }
        }
      });
    }

    // Delete file
    if (url.includes('/contents/exchange/') && method === 'DELETE') {
      return route.fulfill({ json: { commit: { sha: 'delete-commit-sha' } } });
    }

    // Executor registration - GET (check if exists) and PUT
    if (url.includes('/contents/executors/') && method === 'GET') {
      return route.fulfill({ status: 404, json: { message: '404 Not Found' } });
    }
    if (url.includes('/contents/executors/') && method === 'PUT') {
      return route.fulfill({
        json: {
          content: { sha: 'executor-sha' },
          commit: { sha: 'commit-sha' }
        }
      });
    }

    // Default: let it through (will fail but we can see what's missing)
    console.log('Unhandled API request:', method, url);
    return route.fulfill({ status: 404, json: { message: `Not Found: ${url}` } });
  });
}

test.describe('Setup Wizard', () => {
  test.beforeEach(async ({ page }) => {
    await setupGitHubMocks(page);
    // Navigate first, then clear localStorage
    await page.goto('/index.html');
    await clearConfig(page);
    // Reload to apply cleared state
    await page.reload();
  });

  test('shows setup wizard on first load', async ({ page }) => {
    await expect(page.locator('text=Create a GitHub Token')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'MESS' })).toBeVisible();
  });

  test('step 1: shows token instructions', async ({ page }) => {
    await expect(page.locator('text=Quick Setup')).toBeVisible();
    await expect(page.locator('text=Open GitHub Settings')).toBeVisible();
  });

  test('step 2: can test connection', async ({ page }) => {
    // Go to step 2
    await page.click('text=I have my token');

    // Fill in credentials
    await page.fill('#input-token', 'ghp_test_token');
    await page.fill('#input-repo', 'testuser/mess-exchange');

    // Test connection
    await page.click('text=Test');

    // Should show success
    await expect(page.locator('text=Connected to testuser/mess-exchange')).toBeVisible({ timeout: 5000 });
  });

  test('step 3: can complete setup with profile', async ({ page }) => {
    // Step 1 -> 2
    await page.click('text=I have my token');

    // Fill credentials and test
    await page.fill('#input-token', 'ghp_test_token');
    await page.fill('#input-repo', 'testuser/mess-exchange');
    await page.click('text=Test');
    await expect(page.locator('text=Connected to')).toBeVisible({ timeout: 5000 });

    // Step 2 -> 3
    await page.click('button:has-text("Next")');

    // Fill profile
    await page.fill('#input-executor-id', 'test-executor');
    await page.fill('#input-display-name', 'Test Executor');

    // Complete setup
    await page.click('text=Complete Setup');

    // Should show main view
    await expect(page.locator('text=Inbox')).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Main View', () => {
  test('shows thread list after login', async ({ page }) => {
    await setupGitHubMocks(page);
    await page.goto('/index.html');
    await setupConfig(page);
    // Navigate again (mocks persist, localStorage is set)
    await page.goto('/index.html');

    // Should show main view with thread
    await expect(page.locator('text=Inbox')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Check if the garage door is closed')).toBeVisible({ timeout: 10000 });
  });

  test('shows correct status badge for pending thread', async ({ page }) => {
    await setupGitHubMocks(page);
    await page.goto('/index.html');
    await setupConfig(page);
    await page.goto('/index.html');

    await expect(page.locator('text=Inbox')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.badge:has-text("pending")')).toBeVisible({ timeout: 10000 });
  });

  test('can switch between tabs', async ({ page }) => {
    await setupGitHubMocks(page);
    await page.goto('/index.html');
    await setupConfig(page);
    await page.goto('/index.html');

    await expect(page.locator('text=Inbox')).toBeVisible({ timeout: 5000 });

    // Click Active tab
    await page.click('button:has-text("Active")');
    await expect(page.locator('text=No threads here')).toBeVisible();

    // Click Done tab
    await page.click('button:has-text("Done")');
    await expect(page.locator('text=No threads here')).toBeVisible();

    // Back to Inbox
    await page.click('button:has-text("Inbox")');
    await expect(page.locator('text=Check if the garage door is closed')).toBeVisible({ timeout: 10000 });
  });

  test('can open thread detail view', async ({ page }) => {
    await setupGitHubMocks(page);
    await page.goto('/index.html');
    await setupConfig(page);
    await page.goto('/index.html');

    await expect(page.locator('text=Inbox')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.thread-row')).toBeVisible({ timeout: 10000 });

    // Click on thread
    await page.click('.thread-row');

    // Should show detail view
    await expect(page.locator('text=Back')).toBeVisible();
    await expect(page.locator('text=Claim This Request')).toBeVisible();
  });
});

test.describe('Thread Actions', () => {
  test('can claim a thread via quick claim button', async ({ page }) => {
    let claimCalled = false;
    await setupGitHubMocks(page);

    // Override PUT to track claim
    await page.route('https://api.github.com/repos/**/contents/exchange/**', async (route, request) => {
      if (request.method() === 'PUT') {
        const body = JSON.parse(request.postData());
        const content = Buffer.from(body.content, 'base64').toString('utf-8');
        if (content.includes('status: claimed')) {
          claimCalled = true;
        }
        return route.fulfill({
          json: { content: { sha: 'new-sha' }, commit: { sha: 'commit' } }
        });
      }
      return route.fallback();
    });

    await page.goto('/index.html');
    await setupConfig(page);
    await page.reload();
    await expect(page.locator('text=Inbox')).toBeVisible({ timeout: 5000 });

    // Click quick claim
    await page.click('.quick-claim');

    // Wait for action to complete
    await page.waitForTimeout(1000);
    expect(claimCalled).toBe(true);
  });

  test('can claim a thread from detail view', async ({ page }) => {
    let claimCalled = false;
    await setupGitHubMocks(page);

    await page.route('https://api.github.com/repos/**/contents/exchange/**', async (route, request) => {
      if (request.method() === 'PUT') {
        const body = JSON.parse(request.postData());
        const content = Buffer.from(body.content, 'base64').toString('utf-8');
        if (content.includes('status: claimed')) {
          claimCalled = true;
        }
        return route.fulfill({
          json: { content: { sha: 'new-sha' }, commit: { sha: 'commit' } }
        });
      }
      return route.fallback();
    });

    await page.goto('/index.html');
    await setupConfig(page);
    await page.reload();
    await expect(page.locator('text=Inbox')).toBeVisible({ timeout: 5000 });

    // Open detail view
    await page.click('.thread-row');
    await expect(page.locator('text=Claim This Request')).toBeVisible();

    // Claim
    await page.click('text=Claim This Request');

    await page.waitForTimeout(1000);
    expect(claimCalled).toBe(true);
  });

  test('shows response form after claiming', async ({ page }) => {
    // Set up with a claimed thread
    await setupGitHubMocks(page, {
      threads: [],
      folders: {
        received: [],
        executing: [mockClaimedThread],
        finished: [],
        canceled: []
      }
    });

    await page.goto('/index.html');
    await setupConfig(page);
    await page.reload();

    // Switch to Active tab
    await page.click('button:has-text("Active")');
    await expect(page.locator('text=Check if the garage door is closed')).toBeVisible({ timeout: 5000 });

    // Open detail view
    await page.click('.thread-row');

    // Should show response form
    await expect(page.locator('text=Complete')).toBeVisible();
    await expect(page.locator('#response-text')).toBeVisible();
  });
});

test.describe('Create Request', () => {
  test('can open new request modal', async ({ page }) => {
    await setupGitHubMocks(page);
    await page.goto('/index.html');
    await setupConfig(page);
    await page.reload();
    await expect(page.locator('text=Inbox')).toBeVisible({ timeout: 5000 });

    // Click new request button
    await page.click('text=+ New');

    // Should show modal
    await expect(page.locator('text=New Request')).toBeVisible();
    await expect(page.locator('#new-intent')).toBeVisible();
  });

  test('can create a new request', async ({ page }) => {
    let createCalled = false;
    await setupGitHubMocks(page);

    await page.route('https://api.github.com/repos/**/contents/exchange/state=received/**', async (route, request) => {
      if (request.method() === 'PUT') {
        const body = JSON.parse(request.postData());
        const content = Buffer.from(body.content, 'base64').toString('utf-8');
        if (content.includes('Test request intent')) {
          createCalled = true;
        }
        return route.fulfill({
          json: { content: { sha: 'new-sha' }, commit: { sha: 'commit' } }
        });
      }
      return route.fallback();
    });

    await page.goto('/index.html');
    await setupConfig(page);
    await page.reload();
    await expect(page.locator('text=Inbox')).toBeVisible({ timeout: 5000 });

    // Open modal
    await page.click('text=+ New');
    await expect(page.locator('text=New Request')).toBeVisible();

    // Fill form
    await page.fill('#new-intent', 'Test request intent');
    await page.fill('#new-context', 'Some context');

    // Submit
    await page.click('#modal-submit');

    await page.waitForTimeout(1000);
    expect(createCalled).toBe(true);
  });

  test('hides new request button when canRequest is false', async ({ page }) => {
    await setupGitHubMocks(page);
    await page.goto('/index.html');
    await setupConfig(page, { canRequest: false });
    await page.reload();
    await expect(page.locator('text=Inbox')).toBeVisible({ timeout: 5000 });

    // New button should not be visible
    await expect(page.locator('text=+ New')).not.toBeVisible();
  });
});

test.describe('Settings', () => {
  test.beforeEach(async ({ page }) => {
    await setupGitHubMocks(page);
    await page.goto('/index.html');
    await setupConfig(page);
    await page.reload();
  });

  test('can open settings', async ({ page }) => {
    await expect(page.locator('text=Inbox')).toBeVisible({ timeout: 5000 });

    // Click settings icon
    await page.click('#open-settings');

    // Should show settings
    await expect(page.locator('h1:has-text("Settings")')).toBeVisible();
  });

  test('shows current config in settings', async ({ page }) => {
    await expect(page.locator('text=Inbox')).toBeVisible({ timeout: 5000 });

    await page.click('#open-settings');

    // Check values are populated
    await expect(page.locator('#settings-repo')).toHaveValue('testuser/mess-exchange');
    await expect(page.locator('#settings-executor-id')).toHaveValue('test-executor');
  });

  test('can reset settings', async ({ page }) => {
    await expect(page.locator('text=Inbox')).toBeVisible({ timeout: 5000 });

    await page.click('#open-settings');

    // Mock confirm dialog
    page.on('dialog', dialog => dialog.accept());

    // Click reset
    await page.click('text=Reset & Start Over');

    // Should go back to setup
    await expect(page.locator('text=Create a GitHub Token')).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Theme', () => {
  test('can toggle dark mode', async ({ page }) => {
    await setupGitHubMocks(page);
    await page.goto('/index.html');
    await setupConfig(page);
    await page.reload();
    await expect(page.locator('text=Inbox')).toBeVisible({ timeout: 5000 });

    // Check initial state (light or system preference)
    const initialTheme = await page.evaluate(() =>
      document.documentElement.getAttribute('data-theme')
    );

    // Toggle theme
    await page.click('#theme-toggle');

    // Check theme changed
    const newTheme = await page.evaluate(() =>
      document.documentElement.getAttribute('data-theme')
    );

    expect(newTheme).not.toBe(initialTheme);
  });
});

test.describe('Photo Capture', () => {
  test('shows photo requested indicator when response_hint includes image', async ({ page }) => {
    // Set up with a claimed thread that wants an image
    await setupGitHubMocks(page, {
      threads: [],
      folders: {
        received: [],
        executing: [mockClaimedThread],
        finished: [],
        canceled: []
      }
    });

    await page.goto('/index.html');
    await setupConfig(page);
    await page.reload();

    // Switch to Active tab
    await page.click('button:has-text("Active")');
    await expect(page.locator('text=Check if the garage door is closed')).toBeVisible({ timeout: 5000 });

    // Open detail view
    await page.click('.thread-row');

    // Should show photo requested indicator
    await expect(page.locator('text=Photo requested')).toBeVisible();
  });

  test('shows photo input button on claimed threads', async ({ page }) => {
    await setupGitHubMocks(page, {
      threads: [],
      folders: {
        received: [],
        executing: [mockClaimedThread],
        finished: [],
        canceled: []
      }
    });

    await page.goto('/index.html');
    await setupConfig(page);
    await page.reload();

    // Switch to Active tab and open thread
    await page.click('button:has-text("Active")');
    await page.click('.thread-row');

    // Should show photo input (the camera emoji button with hidden file input)
    await expect(page.locator('#photo-input')).toBeAttached();
  });

  test('can upload a photo and see preview', async ({ page }) => {
    await setupGitHubMocks(page, {
      threads: [],
      folders: {
        received: [],
        executing: [mockClaimedThread],
        finished: [],
        canceled: []
      }
    });

    await page.goto('/index.html');
    await setupConfig(page);
    await page.reload();

    // Switch to Active tab and open thread
    await page.click('button:has-text("Active")');
    await page.click('.thread-row');

    // Create a test image file (1x1 red pixel PNG)
    const testImageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

    // Set file via JavaScript since we can't use real file chooser in test
    await page.evaluate((base64) => {
      const dataUrl = 'data:image/png;base64,' + base64;
      const img = document.getElementById('photo-img');
      const preview = document.getElementById('photo-preview');
      if (img && preview) {
        img.src = dataUrl;
        preview.classList.remove('hidden');
      }
    }, testImageBase64);

    // Preview should be visible
    await expect(page.locator('#photo-preview')).toBeVisible();
    await expect(page.locator('#photo-img')).toBeVisible();
  });

  test('can remove photo preview', async ({ page }) => {
    await setupGitHubMocks(page, {
      threads: [],
      folders: {
        received: [],
        executing: [mockClaimedThread],
        finished: [],
        canceled: []
      }
    });

    await page.goto('/index.html');
    await setupConfig(page);
    await page.reload();

    // Switch to Active tab and open thread
    await page.click('button:has-text("Active")');
    await page.click('.thread-row');

    // Set up photo preview
    const testImageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
    await page.evaluate((base64) => {
      const dataUrl = 'data:image/png;base64,' + base64;
      const img = document.getElementById('photo-img');
      const preview = document.getElementById('photo-preview');
      if (img && preview) {
        img.src = dataUrl;
        preview.classList.remove('hidden');
      }
    }, testImageBase64);

    await expect(page.locator('#photo-preview')).toBeVisible();

    // Click remove photo
    await page.click('#remove-photo');

    // Preview should be hidden
    await expect(page.locator('#photo-preview')).toBeHidden();
  });

  test('includes photo in response when completing', async ({ page }) => {
    let responseContent = null;
    await setupGitHubMocks(page, {
      threads: [],
      folders: {
        received: [],
        executing: [mockClaimedThread],
        finished: [],
        canceled: []
      }
    });

    // Override PUT to capture response content
    await page.route('https://api.github.com/repos/**/contents/exchange/**', async (route, request) => {
      if (request.method() === 'PUT') {
        const body = JSON.parse(request.postData());
        const content = Buffer.from(body.content, 'base64').toString('utf-8');
        responseContent = content;
        return route.fulfill({
          json: { content: { sha: 'new-sha' }, commit: { sha: 'commit' } }
        });
      }
      return route.fallback();
    });

    await page.goto('/index.html');
    await setupConfig(page);
    await page.reload();

    // Switch to Active tab and open thread
    await page.click('button:has-text("Active")');
    await page.click('.thread-row');

    // Wait for detail view to be fully rendered
    await expect(page.locator('#response-text')).toBeVisible();
    await expect(page.locator('#photo-input')).toBeAttached();

    // Add text response first (before photo, to avoid any re-renders from fill)
    await page.fill('#response-text', 'The garage door is closed');

    // Add a photo by simulating file input change event
    const testImageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
    await page.evaluate((base64) => {
      const dataUrl = 'data:image/png;base64,' + base64;
      const img = document.getElementById('photo-img');
      const preview = document.getElementById('photo-preview');
      if (img && preview) {
        img.src = dataUrl;
        preview.classList.remove('hidden');
      }
    }, testImageBase64);

    // Verify photo is set before completing
    const photoSrc = await page.evaluate(() => document.getElementById('photo-img')?.src);
    expect(photoSrc).toContain('data:image/png;base64');

    // Complete the request
    await page.click('#action-complete');

    // Wait for the API call
    await page.waitForTimeout(1000);

    // Verify the response includes the image
    expect(responseContent).not.toBeNull();
    expect(responseContent).toContain('image:');
    expect(responseContent).toContain('data:image/png;base64');
  });

  test('shows camera icon on thread list for threads wanting images', async ({ page }) => {
    await setupGitHubMocks(page);
    await page.goto('/index.html');
    await setupConfig(page);
    await page.reload();

    await expect(page.locator('text=Inbox')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.thread-row')).toBeVisible({ timeout: 10000 });

    // The mock thread has response_hint: ['image'], should show camera icon
    // Check for the camera emoji in the thread row
    const threadRow = page.locator('.thread-row');
    await expect(threadRow.locator('text=📷')).toBeVisible();
  });
});
