// These are browser execution limits, not claims about JavaScript heap bytes.
export const RESOURCE_LIMITS = Object.freeze({
  instructions: 20000,
  valueSize: 100000,
  allocations: 2000000,
  depth: 100,
  turtles: 64,
  outputCharacters: 20000,
  outputMessages: 1000
});

export class ResourceLimitError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ResourceLimitError';
    this.code = 'RESOURCE_LIMIT';
  }
}

export class ExecutionBudget {
  constructor(limits = RESOURCE_LIMITS) {
    this.limits = limits;
    this.instructions = 0;
    this.allocations = 0;
    this.failure = null;
  }

  fail(message) {
    if (this.failure === null) this.failure = new ResourceLimitError(message);
    throw this.failure;
  }

  check() {
    if (this.failure) throw this.failure;
  }

  instruction() {
    this.check();
    this.instructions++;
    if (this.instructions > this.limits.instructions) this.fail('Program reached its instruction limit. Use fewer repetitions.');
  }

  checkSize(size) {
    this.check();
    if (!Number.isSafeInteger(size) || size < 0 || size > this.limits.valueSize) {
      this.fail('Program value exceeds the collection or word size limit.');
    }
  }

  checkAllocation(size) {
    this.check();
    if (!Number.isSafeInteger(size) || size < 0 || size > this.limits.allocations - this.allocations) {
      this.fail('Program reached its allocation limit. Use smaller collections or fewer copies.');
    }
  }

  allocate(size) {
    this.checkSize(size);
    this.checkAllocation(size);
    this.allocations += size;
  }

  checkDepth(depth) {
    this.check();
    if (depth > this.limits.depth) this.fail('Program reached its nesting or call depth limit.');
  }

  checkTurtle(index) {
    this.check();
    if (!Number.isInteger(index) || index < 0 || index >= this.limits.turtles) {
      this.fail('Program turtle index exceeds the browser turtle limit.');
    }
  }
}

// Count everything emitted during a Run. Clearing the display never restores
// either allowance. The page uses its own instance to check received output.
export class OutputBudget {
  constructor(limits = RESOURCE_LIMITS) {
    this.limits = limits;
    this.characters = 0;
    this.messages = 0;
  }

  accept(value = '') {
    if (typeof value !== 'string' || value.length > this.limits.outputCharacters - this.characters) {
      throw new ResourceLimitError(`Program output exceeded ${this.limits.outputCharacters.toLocaleString('en-US')} characters during this Run.`);
    }
    if (this.messages >= this.limits.outputMessages) {
      throw new ResourceLimitError('Program reached its output message limit.');
    }
    this.characters += value.length;
    this.messages++;
  }
}
