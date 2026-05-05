// @vitest-environment jsdom
// Component tests for NodeContentInner — the markdown renderer.
// Verifies the reader-facing rendering pipeline: address linkification,
// UUID navigation links, and basic markdown output.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import NodeContentInner from "./NodeContentInner";
import { setAddressMap } from "../lib/addressMap";

const EVM = "0xae7ab96520de3a18e5e111b5eaab095312d7fe84";
const UUID = "1ce24b08-84ff-4524-9710-49bba429c6ef";

beforeEach(() => setAddressMap({}));
afterEach(cleanup);

describe("EVM address rendering", () => {
  it("renders an EVM address as a link to etherscan", async () => {
    render(<NodeContentInner content={`See ${EVM} for details.`} />);
    const link = await screen.findByRole("link", { name: EVM });
    expect(link).toHaveAttribute("href", `https://etherscan.io/address/${EVM}`);
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("uses explorerUrl from the address map when set", async () => {
    setAddressMap({ [EVM.toLowerCase()]: { explorerUrl: "https://custom.io/addr" } });
    render(<NodeContentInner content={EVM} />);
    const link = await screen.findByRole("link", { name: EVM });
    expect(link).toHaveAttribute("href", "https://custom.io/addr");
  });
});

describe("UUID link rendering", () => {
  it("renders a UUID markdown link with SPA href and calls onNavigate", async () => {
    const onNavigate = vi.fn();
    render(
      <NodeContentInner
        content={`[Go to node](${UUID})`}
        onNavigate={onNavigate}
      />,
    );
    const link = await screen.findByRole("link", { name: "Go to node" });
    expect(link).toHaveAttribute("href", `/atlas?id=${UUID}`);
    await userEvent.click(link);
    expect(onNavigate).toHaveBeenCalledWith(UUID);
  });

  it("renders a UUID link as external when no onNavigate is provided", async () => {
    render(<NodeContentInner content={`[Go to node](${UUID})`} />);
    const link = await screen.findByRole("link", { name: "Go to node" });
    expect(link).toHaveAttribute("target", "_blank");
  });
});

describe("basic markdown", () => {
  it("renders plain text without crashing", async () => {
    render(<NodeContentInner content="Hello world." />);
    expect(await screen.findByText("Hello world.")).toBeInTheDocument();
  });

  it("renders a markdown table", async () => {
    const md = "| A | B |\n|---|---|\n| 1 | 2 |";
    render(<NodeContentInner content={md} />);
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });

  it("renders bold text", async () => {
    render(<NodeContentInner content="**important**" />);
    const strong = await screen.findByText("important");
    expect(strong.tagName).toBe("STRONG");
  });
});
