export class TauError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "TauError";
    this.code = code;
    this.details = details;
  }
}
export class ControlViolationError extends TauError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("CONTROL_VIOLATION", message, details);
    this.name = "ControlViolationError";
  }
}
export class UnbalancedEntryError extends TauError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("UNBALANCED_ENTRY", message, details);
    this.name = "UnbalancedEntryError";
  }
}
export class PeriodLockedError extends TauError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("PERIOD_LOCKED", message, details);
    this.name = "PeriodLockedError";
  }
}
export class ApprovalRequiredError extends TauError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("APPROVAL_REQUIRED", message, details);
    this.name = "ApprovalRequiredError";
  }
}
export class PermissionDeniedError extends TauError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("PERMISSION_DENIED", message, details);
    this.name = "PermissionDeniedError";
  }
}
export class UnknownInformationError extends TauError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("INSUFFICIENT_INFORMATION", message, details);
    this.name = "UnknownInformationError";
  }
}
