export class MemoryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MemoryValidationError';
  }
}

export class DuplicateMemoryError extends Error {
  constructor(message = 'Memory already exists') {
    super(message);
    this.name = 'DuplicateMemoryError';
  }
}

/**
 * Raised when a `memory://local/...` reference fails strict parsing. The message
 * deliberately never echoes the rejected reference.
 */
export class InvalidMemoryReferenceError extends MemoryValidationError {
  readonly code = 'INVALID_MEMORY_REFERENCE';
  constructor(message = 'Invalid memory reference') {
    super(message);
    this.name = 'InvalidMemoryReferenceError';
  }
}
