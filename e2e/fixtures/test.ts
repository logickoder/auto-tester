import { test as base, expect, type Page } from "@playwright/test";
import { statePath } from "./users";

/** Prefix for everything a test creates (FR-5). CI sets RUN_TAG=gh-<run number>. */
export const RUN_TAG = (process.env.RUN_TAG ?? `local-${Date.now().toString(36)}`).toLowerCase();

type Fixtures = {
  /** Logged-in page for test user A, in its own browser context. */
  userA: Page;
  /** Logged-in page for test user B — a second, isolated context (FR-4). */
  userB: Page;
  /** unique("chan") -> "gh-42-ab12cd-chan": run-ID prefixed, so leftovers are easy to find. */
  unique: (label: string) => string;
  /** Register a cleanup step; steps run in reverse order after the test, even when it failed. */
  cleanup: (step: () => Promise<void>) => void;
};

export const test = base.extend<Fixtures>({
  userA: async ({ browser }, use) => {
    const context = await browser.newContext({ storageState: statePath("userA") });
    await use(await context.newPage());
    await context.close();
  },
  userB: async ({ browser }, use) => {
    const context = await browser.newContext({ storageState: statePath("userB") });
    await use(await context.newPage());
    await context.close();
  },
  // eslint-disable-next-line no-empty-pattern
  unique: async ({}, use, testInfo) => {
    const short = testInfo.testId.slice(0, 6);
    await use((label) => `${RUN_TAG}-${short}-${label}`.toLowerCase());
  },
  // eslint-disable-next-line no-empty-pattern
  cleanup: async ({}, use) => {
    const steps: Array<() => Promise<void>> = [];
    await use((step) => {
      steps.push(step);
    });
    for (const step of steps.reverse()) {
      try {
        await step();
      } catch (error) {
        console.warn("cleanup step failed:", error);
      }
    }
  },
});

export { expect };
