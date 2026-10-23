import { describe, expect, it } from "vitest";
import { type CardLandingInput, planCardLanding } from "./iceSelectionLanding";

function input(overrides: Partial<CardLandingInput> = {}): CardLandingInput {
  return {
    cardId: "card-1",
    created: false,
    canEditContent: true,
    readOnly: false,
    hasPlacement: true,
    ...overrides,
  };
}

describe("planCardLanding", () => {
  it("should open the inspector on the title for a created card", () => {
    expect(planCardLanding(input({ created: true }))).toEqual({
      openInspector: true,
      startField: "title",
      focusSurface: false,
    });
  });

  it("should open the inspector without a caret for a selected card", () => {
    expect(planCardLanding(input())).toEqual({
      openInspector: true,
      startField: null,
      focusSurface: false,
    });
  });

  it("should open the inspector but leave the caret alone without content rights", () => {
    expect(planCardLanding(input({ created: true, canEditContent: false }))).toEqual({
      openInspector: true,
      startField: null,
      focusSurface: false,
    });
  });

  it("should use the focus surface for an unplaced created card", () => {
    expect(planCardLanding(input({ created: true, hasPlacement: false }))).toEqual({
      openInspector: false,
      startField: "title",
      focusSurface: true,
    });
  });

  it("should use the focus surface for an unplaced selection", () => {
    expect(planCardLanding(input({ hasPlacement: false }))).toEqual({
      openInspector: false,
      startField: null,
      focusSurface: true,
    });
  });

  it("should decline every surface for a viewer's card", () => {
    for (const created of [false, true]) {
      for (const hasPlacement of [false, true]) {
        expect(planCardLanding(input({ created, hasPlacement, readOnly: true }))).toEqual({
          openInspector: false,
          startField: null,
          focusSurface: false,
        });
      }
    }
  });

  it("should decline a landing when no card was named", () => {
    expect(planCardLanding(input({ cardId: "" }))).toEqual({
      openInspector: false,
      startField: null,
      focusSurface: false,
    });
  });

  it("should never return both the inspector and the focus surface", () => {
    for (const created of [false, true]) {
      for (const canEditContent of [false, true]) {
        for (const readOnly of [false, true]) {
          for (const hasPlacement of [false, true]) {
            const plan = planCardLanding(
              input({ created, canEditContent, readOnly, hasPlacement }),
            );
            expect(plan.openInspector && plan.focusSurface).toBe(false);
          }
        }
      }
    }
  });
});
