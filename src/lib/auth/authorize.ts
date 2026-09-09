import type { SpaceRole, Viewer, ViewerSpace } from "./session";

export class AuthorizationError extends Error {
  constructor(message = "You do not have access to this space.") {
    super(message);
    this.name = "AuthorizationError";
  }
}

const RANK: Record<SpaceRole, number> = { viewer: 1, editor: 2, owner: 3 };

export function spaceFor(viewer: Viewer, spaceId: string): ViewerSpace | null {
  return viewer.spaces.find((sp) => sp.id === spaceId) ?? null;
}

export function canView(viewer: Viewer, spaceId: string): boolean {
  return spaceFor(viewer, spaceId) !== null;
}

export function canEdit(viewer: Viewer, spaceId: string): boolean {
  const sp = spaceFor(viewer, spaceId);
  return !!sp && RANK[sp.role] >= RANK.editor;
}

export function isSpaceOwner(viewer: Viewer, spaceId: string): boolean {
  const sp = spaceFor(viewer, spaceId);
  return !!sp && sp.role === "owner";
}

/** Throws unless the viewer holds at least `level` on the space. Use in every action and route. */
export function assertSpaceAccess(viewer: Viewer, spaceId: string, level: "view" | "edit" | "owner"): ViewerSpace {
  const sp = spaceFor(viewer, spaceId);
  if (!sp) throw new AuthorizationError();
  const needed = level === "view" ? RANK.viewer : level === "edit" ? RANK.editor : RANK.owner;
  if (RANK[sp.role] < needed) throw new AuthorizationError(`This needs ${level} access to ${sp.name}.`);
  return sp;
}

export function assertWorkspaceOwner(viewer: Viewer): void {
  if (viewer.workspaceRole !== "owner") throw new AuthorizationError("Only workspace owners can do this.");
}

/** Company-level assumptions are editable by anyone who can edit the company space. */
export function canEditAssumptions(viewer: Viewer): boolean {
  return viewer.spaces.some((sp) => sp.kind === "company" && RANK[sp.role] >= RANK.editor) || viewer.workspaceRole === "owner";
}
