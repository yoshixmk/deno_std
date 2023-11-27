// Copyright 2018-2023 the Deno authors. All rights reserved. MIT license.
// This module is browser compatible.

import type { Writer } from "@std/io/types";

/**
 * @deprecated (will be removed after 1.0.0) Use {@linkcode WritableStreamDefaultWriter} directly.
 *
 * Create a `Writer` from a `WritableStreamDefaultWriter`.
 *
 * @example
 * ```ts
 * import { copy } from "@std/streams/copy";
 * import { writerFromStreamWriter } from "@std/streams/writer_from_stream_writer";
 *
 * const file = await Deno.open("./deno.land.html", { read: true });
 *
 * const writableStream = new WritableStream({
 *   write(chunk): void {
 *     console.log(chunk);
 *   },
 * });
 * const writer = writerFromStreamWriter(writableStream.getWriter());
 * await copy(file, writer);
 * file.close();
 * ```
 */
export function writerFromStreamWriter(
  streamWriter: WritableStreamDefaultWriter<Uint8Array>,
): Writer {
  return {
    async write(p: Uint8Array): Promise<number> {
      await streamWriter.ready;
      await streamWriter.write(p);
      return p.length;
    },
  };
}
