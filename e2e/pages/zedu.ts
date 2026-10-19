import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Every Zedu selector lives in this file (core helpers squad, frozen end of Day 2),
 * so a UI change is a one-file fix. Lines marked TODO are educated guesses:
 * confirm them on staging with `npx playwright codegen <staging url>` and ask the
 * product team for data-testid attributes where nothing stable exists
 * (PRD open question 6). No fixed sleeps: every wait is an auto-waiting expect.
 */
export class Zedu {
  constructor(readonly page: Page) {}

  // --- auth -----------------------------------------------------------------
  async login(email: string, password: string) {
    await this.page.goto("/login");
    await this.page.getByLabel(/email/i).fill(email); // TODO confirm label
    await this.page.getByLabel(/password/i).fill(password); // TODO confirm label
    await this.page.getByRole("button", { name: /log in|sign in/i }).click(); // TODO confirm text
    await expect(this.sidebar()).toBeVisible();
  }

  async logout() {
    await this.page.getByTestId("user-menu").click(); // TODO data-testid
    await this.page.getByRole("menuitem", { name: /log out|sign out/i }).click();
    await expect(this.page).toHaveURL(/login/);
  }

  sidebar(): Locator {
    return this.page.getByTestId("sidebar"); // TODO data-testid
  }

  // --- channels --------------------------------------------------------------
  async createChannel(name: string) {
    await this.page.getByRole("button", { name: /new channel|create channel/i }).click(); // TODO
    await this.page.getByLabel(/channel name/i).fill(name);
    await this.page.getByRole("button", { name: /^create$/i }).click();
    await expect(this.page.getByRole("heading", { name })).toBeVisible();
  }

  async joinChannel(name: string) {
    await this.page.getByRole("button", { name: /browse channels/i }).click(); // TODO
    await this.page.getByPlaceholder(/search/i).fill(name);
    await this.page.getByRole("button", { name: /^join$/i }).first().click();
    await expect(this.page.getByRole("heading", { name })).toBeVisible();
  }

  async openChannel(name: string) {
    await this.sidebar().getByRole("link", { name, exact: true }).click();
    await expect(this.page.getByRole("heading", { name })).toBeVisible();
  }

  /** Cleanup helper (FR-5). Archive instead if Zedu has no delete. */
  async deleteChannel(name: string) {
    await this.openChannel(name);
    await this.page.getByRole("button", { name: /channel settings/i }).click(); // TODO
    await this.page.getByRole("menuitem", { name: /delete channel/i }).click();
    await this.page.getByRole("button", { name: /^delete$/i }).click();
    await expect(this.sidebar().getByRole("link", { name, exact: true })).toHaveCount(0);
  }

  // --- messages --------------------------------------------------------------
  composer(): Locator {
    return this.page.getByRole("textbox", { name: /message/i }); // TODO
  }

  messageList(): Locator {
    return this.page.getByTestId("message-list"); // TODO data-testid
  }

  async sendMessage(text: string) {
    await this.composer().fill(text);
    await this.composer().press("Enter");
    await this.expectMessage(text);
  }

  /** Waits for real-time delivery — no reload, no sleep (NFR Waiting). */
  async expectMessage(text: string) {
    await expect(this.messageList().getByText(text, { exact: true })).toBeVisible({ timeout: 20_000 });
  }

  threadPanel(): Locator {
    return this.page.getByTestId("thread-panel"); // TODO data-testid
  }

  async openThread(messageText: string) {
    await this.messageList().getByText(messageText, { exact: true }).hover();
    await this.page.getByRole("button", { name: /reply in thread|replies/i }).click(); // TODO
    await expect(this.threadPanel()).toBeVisible();
  }

  async replyInThread(messageText: string, reply: string) {
    await this.openThread(messageText);
    const box = this.threadPanel().getByRole("textbox");
    await box.fill(reply);
    await box.press("Enter");
    await expect(this.threadPanel().getByText(reply, { exact: true })).toBeVisible();
  }

  /** Hover a message and pick an entry from its actions menu (edit, delete, ...). */
  async messageAction(messageText: string, action: RegExp) {
    await this.messageList().getByText(messageText, { exact: true }).hover();
    await this.page.getByRole("button", { name: /more actions|message actions/i }).click(); // TODO
    await this.page.getByRole("menuitem", { name: action }).click();
  }

  async editMessage(oldText: string, newText: string) {
    await this.messageAction(oldText, /^edit/i);
    const box = this.messageList().getByRole("textbox"); // TODO inline editor or composer?
    await box.fill(newText);
    await box.press("Enter");
    await this.expectMessage(newText);
  }

  async deleteMessage(text: string) {
    await this.messageAction(text, /^delete/i);
    await this.page.getByRole("button", { name: /^delete$/i }).click(); // TODO confirm dialog text
    await expect(this.messageList().getByText(text, { exact: true })).toHaveCount(0);
  }

  async leaveChannel(name: string) {
    await this.openChannel(name);
    await this.page.getByRole("button", { name: /channel settings/i }).click(); // TODO
    await this.page.getByRole("menuitem", { name: /leave channel/i }).click();
    await expect(this.sidebar().getByRole("link", { name, exact: true })).toHaveCount(0);
  }

  /** Unread marker on a channel in the sidebar. */
  unreadBadge(channelName: string): Locator {
    return this.sidebar().getByRole("link", { name: channelName }).getByTestId("unread-badge"); // TODO data-testid
  }

  // --- search ----------------------------------------------------------------
  async search(query: string) {
    await this.page.getByRole("searchbox").or(this.page.getByPlaceholder(/search/i)).first().fill(query); // TODO
    await this.page.keyboard.press("Enter");
  }

  searchResults(): Locator {
    return this.page.getByTestId("search-results"); // TODO data-testid
  }

  // --- settings --------------------------------------------------------------
  async openProfileSettings() {
    await this.page.getByTestId("user-menu").click(); // TODO data-testid
    await this.page.getByRole("menuitem", { name: /profile|settings/i }).first().click(); // TODO
  }

  async openDirectMessage(displayName: string) {
    await this.page.getByRole("button", { name: /new message|direct message/i }).click(); // TODO
    await this.page.getByPlaceholder(/search people|to:/i).fill(displayName);
    await this.page.getByRole("option", { name: displayName }).click();
    await expect(this.page.getByRole("heading", { name: displayName })).toBeVisible();
  }

  async uploadFile(fileName: string, content: string) {
    await this.page
      .locator('input[type="file"]')
      .setInputFiles({ name: fileName, mimeType: "text/plain", buffer: Buffer.from(content) });
    await this.page.getByRole("button", { name: /^send$|upload/i }).click(); // TODO
    await expect(this.messageList().getByText(fileName)).toBeVisible();
  }
}
