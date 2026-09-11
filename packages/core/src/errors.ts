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
