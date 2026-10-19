import { test as setup, expect } from "@playwright/test";
import { USERS, statePath } from "../fixtures/users";
import { Zedu } from "../pages/zedu";

// Runs once before the "chromium" project (see playwright.config.ts).

setup("staging is reachable @P0 @environment", async ({ request }) => {
  const response = await request.get("/", { timeout: 15_000, failOnStatusCode: false });
  expect(response.status(), "ENVIRONMENT_DOWN: staging did not answer").toBeLessThan(500);
});

// FR-3: log in once per role and save the browser state for every test.
for (const role of ["userA", "userB"] as const) {
  setup(`authenticate ${role} @P0 @auth`, async ({ page }) => {
    const user = USERS[role];
    await new Zedu(page).login(user.email, user.password);
    await page.context().storageState({ path: statePath(role) });
  });
}
