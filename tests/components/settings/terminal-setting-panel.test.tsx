// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TerminalSettingPanel } from "@/components/settings/terminal-setting-panel";

function renderPanel(showsClaudeSetup: boolean) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TerminalSettingPanel initialValue needsPasswordToEnable showsClaudeSetup={showsClaudeSetup} />
    </QueryClientProvider>,
  );
}

describe("TerminalSettingPanel", () => {
  it("on a server, shows how to install Claude Code for the cmm user", () => {
    renderPanel(true);
    expect(screen.getByTestId("terminal-claude-setup").textContent).toContain(
      "sudo -u cmm -H bash -c 'curl -fsSL https://claude.ai/install.sh | bash'",
    );
  });

  it("leaves the note out elsewhere (the desktop app's terminals run as the person)", () => {
    renderPanel(false);
    expect(screen.queryByTestId("terminal-claude-setup")).toBeNull();
  });
});
