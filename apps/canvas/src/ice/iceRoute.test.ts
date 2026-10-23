import { describe, expect, it } from "vitest";
import {
  ICE_SURFACE,
  iceUrlFor,
  legacyCanvasRedirect,
  requestedSurface,
  workspaceUrl,
} from "./iceRoute";

const OWNER = "#owner=KMA3VA6_zUWxYao6zs1LdNn49vCkTwPTf44EwRTBEcU";

describe("iceRoute", () => {
  it("should add the ICE surface without losing the workspace or the owner fragment", () => {
    const href = `/?workspace=8ad07ccf-5884-45ba-a065-0f0b50caafb9&board=board-1${OWNER}`;

    expect(iceUrlFor(href)).toBe(
      `/?workspace=8ad07ccf-5884-45ba-a065-0f0b50caafb9&board=board-1&canvas=ice${OWNER}`,
    );
  });

  it("should replace an existing surface value rather than add a second one", () => {
    expect(iceUrlFor("/?canvas=scene&workspace=w1")).toBe("/?canvas=ice&workspace=w1");
    expect(iceUrlFor("/?canvas=flow")).toBe("/?canvas=ice");
  });

  it("should keep a share token", () => {
    expect(iceUrlFor("/?share=tok&canvas=scene")).toBe("/?share=tok&canvas=ice");
  });

  it("should return the input unchanged when it cannot be parsed", () => {
    expect(iceUrlFor("http://[not-a-url")).toBe("http://[not-a-url");
  });

  it("should report the requested surface", () => {
    expect(requestedSurface("/?canvas=flow")).toBe("flow");
    expect(requestedSurface("/?canvas=ice")).toBe(ICE_SURFACE);
    expect(requestedSurface("/?workspace=w")).toBeNull();
  });

  it("should redirect a legacy flow or scene link to ICE", () => {
    expect(legacyCanvasRedirect(`/?canvas=scene&workspace=w1${OWNER}`)).toBe(
      `/?canvas=ice&workspace=w1${OWNER}`,
    );
    expect(legacyCanvasRedirect("/?canvas=flow&workspace=w1")).toBe("/?canvas=ice&workspace=w1");
  });

  it("should not redirect a link that already asks for ICE or asks for nothing", () => {
    expect(legacyCanvasRedirect("/?canvas=ice&workspace=w1")).toBeNull();
    expect(legacyCanvasRedirect("/?workspace=w1")).toBeNull();
    expect(legacyCanvasRedirect("/")).toBeNull();
  });

  it("should build a fresh workspace URL on ICE", () => {
    expect(workspaceUrl("w1")).toBe("/?workspace=w1&canvas=ice");
  });
});
