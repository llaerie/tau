import { describe, expect, it } from "vitest";
import { assertSpaceAccess, AuthorizationError, canEdit, canView } from "./authorize";
import type { Viewer } from "./session";

const viewer = {
  spaces: [
    { id: "company", kind: "company", name: "Co", personId: null, role: "viewer" },
    { id: "mine", kind: "personal", name: "Me", personId: "p", role: "owner" },
  ],
  workspaceRole: "member",
} as unknown as Viewer;

describe("authorization", () => {
  it("denies spaces the viewer has no permission on, even by id", () => {
    expect(canView(viewer, "partner-personal")).toBe(false);
    expect(() => assertSpaceAccess(viewer, "partner-personal", "view")).toThrow(AuthorizationError);
  });
  it("enforces role levels", () => {
    expect(canView(viewer, "company")).toBe(true);
    expect(canEdit(viewer, "company")).toBe(false);
    expect(() => assertSpaceAccess(viewer, "company", "edit")).toThrow(/edit access/);
    expect(assertSpaceAccess(viewer, "mine", "owner").role).toBe("owner");
  });
});
