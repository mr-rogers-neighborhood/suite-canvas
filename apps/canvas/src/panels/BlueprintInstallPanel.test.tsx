import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { BlueprintSpec } from "../canvas/blueprints/blueprint";
import { BlueprintInstallPanel } from "./BlueprintInstallPanel";

const spec: BlueprintSpec = {
  name: "Claim",
  version: 3,
  fields: [
    { name: "Confidence", kind: "select", required: false },
    { name: "Source", kind: "card", required: false },
  ],
  starterContent: "Say what the source claims.",
};

describe("BlueprintInstallPanel", () => {
  it("should name the blueprint and its version", () => {
    render(<BlueprintInstallPanel spec={spec} existingType={null} onInstall={() => {}} />);
    expect(screen.getByTestId("blueprint-version")).toHaveTextContent("Blueprint v3");
  });

  it("should say what the install is about to write", () => {
    render(<BlueprintInstallPanel spec={spec} existingType={null} onInstall={() => {}} />);
    expect(screen.getByTestId("blueprint-plan")).toHaveTextContent("2 new fields");
  });

  it("should count only the fields still checked", () => {
    render(<BlueprintInstallPanel spec={spec} existingType={null} onInstall={() => {}} />);
    fireEvent.click(screen.getByTestId("blueprint-field-Source"));
    expect(screen.getByTestId("blueprint-plan")).toHaveTextContent("1 new field");
  });

  it("should mark a field the type already has as kept", () => {
    render(
      <BlueprintInstallPanel
        spec={spec}
        existingType={{ id: "claim", name: "Claim", fields: [{ name: "Source" }] } as never}
        onInstall={() => {}}
      />,
    );
    expect(screen.getByTestId("blueprint-kept-Source")).toBeInTheDocument();
    expect(screen.queryByTestId("blueprint-kept-Confidence")).toBeNull();
    expect(screen.getByTestId("blueprint-plan")).toHaveTextContent("1 new field · 1 kept");
  });

  it("should install the units the reader left checked", () => {
    const onInstall = vi.fn();
    render(<BlueprintInstallPanel spec={spec} existingType={null} onInstall={onInstall} />);
    fireEvent.click(screen.getByTestId("blueprint-field-Source"));
    fireEvent.click(screen.getByTestId("blueprint-content"));
    fireEvent.click(screen.getByTestId("blueprint-install-button"));
    expect(onInstall).toHaveBeenCalledWith({
      type: true,
      fields: ["Confidence"],
      starterContent: false,
    });
  });

  it("should offer no button when nothing is chosen", () => {
    render(<BlueprintInstallPanel spec={spec} existingType={null} onInstall={() => {}} />);
    for (const name of ["Confidence", "Source"]) {
      fireEvent.click(screen.getByTestId(`blueprint-field-${name}`));
    }
    fireEvent.click(screen.getByTestId("blueprint-content"));
    expect(screen.getByTestId("blueprint-plan")).toHaveTextContent("Nothing selected");
    expect(screen.getByTestId("blueprint-install-button")).toBeDisabled();
  });

  it("should say there is nothing new when the type already covers the blueprint", () => {
    render(
      <BlueprintInstallPanel
        spec={spec}
        existingType={
          {
            id: "claim",
            name: "Claim",
            fields: [{ name: "Confidence" }, { name: "Source" }],
          } as never
        }
        onInstall={() => {}}
      />,
    );
    expect(screen.getByTestId("blueprint-plan")).toHaveTextContent("Nothing new in the type");
  });

  it("should not offer starter content when the blueprint declares none", () => {
    render(
      <BlueprintInstallPanel
        spec={{ ...spec, starterContent: "" }}
        existingType={null}
        onInstall={() => {}}
      />,
    );
    expect(screen.queryByTestId("blueprint-content")).toBeNull();
  });
});
