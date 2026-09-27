// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const navigation = vi.hoisted(() => ({ search: "" }));
const startOAuth = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(navigation.search) }));
vi.mock("convex/react", () => ({ useAction: () => startOAuth }));
vi.mock("../../../convex/_generated/api", () => ({ api: { linear: { startLinearOAuth: "linear:startLinearOAuth" } } }));

import LinearConnectPage from "../src/app/linear/connect/page";

beforeEach(() => {
  navigation.search = "";
  startOAuth.mockReset();
  startOAuth.mockResolvedValue({ authorizationUrl: "https://linear.app/oauth/authorize" });
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://deployment.convex.cloud");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://web.example");
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("Linear connect page", () => {
  test("shows explicit consent before starting OAuth", () => {
    navigation.search = "?requestId=fixture-request";
    render(<LinearConnectPage />);
    expect(screen.getByRole("heading", { name: "Connect Linear" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue to Linear" })).toBeTruthy();
    expect(screen.getByText(/tokens stay on the server/)).toBeTruthy();
  });

  test("shows approved and denied completion states without exposing credentials", () => {
    navigation.search = "?requestId=fixture-request&result=approved";
    const approved = render(<LinearConnectPage />);
    expect(screen.getByRole("heading", { name: "Linear connected" })).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    approved.unmount();

    navigation.search = "?requestId=fixture-request&result=denied";
    render(<LinearConnectPage />);
    expect(screen.getByRole("heading", { name: "Connection not approved" })).toBeTruthy();
    expect(screen.getByText(/No connection was created/)).toBeTruthy();
  });

  test("explains missing browser configuration and missing request IDs", () => {
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "");
    navigation.search = "?requestId=fixture-request";
    const missingConfig = render(<LinearConnectPage />);
    expect(screen.getByRole("heading", { name: "Service configuration required" })).toBeTruthy();
    missingConfig.unmount();

    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://deployment.convex.cloud");
    navigation.search = "";
    render(<LinearConnectPage />);
    expect(screen.getByRole("heading", { name: "Connection request missing" })).toBeTruthy();
  });

  test("reports an authorization-start failure without navigating", async () => {
    navigation.search = "?requestId=fixture-request";
    startOAuth.mockRejectedValueOnce(new Error("private backend detail"));
    render(<LinearConnectPage />);
    fireEvent.click(screen.getByRole("button", { name: "Continue to Linear" }));
    expect(await screen.findByRole("heading", { name: "Unable to start connection" })).toBeTruthy();
    expect(screen.queryByText(/private backend detail/)).toBeNull();
  });
});
