// Copyright 2018-2023 the Deno authors. All rights reserved. MIT license.

/** Error thrown when an assertion fails. */
export class AssertionError extends Error {
  /**
   * Constructs a new {@linkcode AssertionError} instance.
   *
   * @example
   * ```
   * import { AssertionError } from "https://deno.land/std@$STD_VERSION/assert/assertion_error.ts";
   *
   * throw new AssertionError("foo is missing");
   * ```
   */
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}
