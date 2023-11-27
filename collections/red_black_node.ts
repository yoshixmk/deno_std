// Copyright 2018-2023 the Deno authors. All rights reserved. MIT license.
// This module is browser compatible.

export {
  /**
   * @deprecated (will be removed in 0.209.0) Use {@linkcode RedBlackTree} from {@link https://deno.land/std/data_structures/red_black_tree.ts} instead.
   */
  RedBlackNode,
} from "@std/data_structures/_red_black_node";

/** @deprecated (will be removed in 0.209.0) Use `"left" | "right"` union type instead */
export type Direction = "left" | "right";
