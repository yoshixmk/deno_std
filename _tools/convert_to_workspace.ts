// Copyright 2018-2023 the Deno authors. All rights reserved. MIT license.

import { walk } from "../fs/walk.ts";
import {
  dirname,
  fromFileUrl,
  join,
  relative,
  toFileUrl,
} from "../path/mod.ts";
import { VERSION } from "../version.ts";

const cwd = await Deno.realPath(".");

await Deno.remove("./types.d.ts");
await Deno.remove("./version.ts");

const toRemove = `1. Do not import symbols with an underscore in the name.

   Bad:
   \`\`\`ts
   import { _format } from "https://deno.land/std@$STD_VERSION/path/_common/format.ts";
   \`\`\`

1. Do not import modules with an underscore in the path.

   Bad:
   \`\`\`ts
   import { filterInPlace } from "https://deno.land/std@$STD_VERSION/collections/_utils.ts";
   \`\`\`

1. Do not import test modules or test data.

   Bad:
   \`\`\`ts
   import { test } from "https://deno.land/std@$STD_VERSION/front_matter/test.ts";
   \`\`\`
`;
let readme = await Deno.readTextFile("README.md");
readme = readme.replace(toRemove, "");
await Deno.writeTextFile("README.md", readme);

let fileServer = await Deno.readTextFile("http/file_server.ts");
fileServer = fileServer.replace(
  `import { VERSION } from "../version.ts";`,
  `import { version } from "./deno.json" assert { type: "json" };`,
);
fileServer = fileServer.replaceAll("${VERSION}", "${version}");
fileServer = fileServer.replace(
  "https://deno.land/std/http/file_server.ts",
  "jsr:@std/http@${version}/file_server",
);
await Deno.writeTextFile("http/file_server.ts", fileServer);

let fileServerTest = await Deno.readTextFile("http/file_server_test.ts");
fileServerTest = fileServerTest.replace(
  `import { VERSION } from "../version.ts";`,
  `import { version } from "./deno.json" assert { type: "json" };`,
);
fileServerTest = fileServerTest.replaceAll("${VERSION}", "${version}");
await Deno.writeTextFile("http/file_server_test.ts", fileServerTest);

const packages = [];
for await (const entry of Deno.readDir(".")) {
  if (
    entry.isDirectory && !entry.name.startsWith(".") &&
    !entry.name.startsWith("_")
  ) {
    packages.push(entry.name);
  }
}
packages.sort();

console.log("Discovered", packages.length, "packages.");

async function discoverExports(pkg: string) {
  const exports: [string, string][] = [];
  const base = await Deno.realPath(pkg);
  const files = walk(base);
  for await (const file of files) {
    if (!file.isFile) continue;
    const path = "/" + relative(base, file.path);
    const name = path.replace(/(\.d)?\.ts$/, "");
    if (name === path && !name.endsWith(".json")) continue; // not a typescript
    if (name.includes("/.") || name.includes("/_")) continue; // hidden/internal files
    if (name.endsWith("_test") || name.endsWith("/test")) continue; // test files
    if (name.includes("/example/") || name.endsWith("_example")) continue; // example files
    if (name.includes("/testdata/")) continue; // testdata files
    if (name.endsWith("/deno.json")) continue; // deno.json files

    const key = "." + name.replace(/\/mod$/, "");
    exports.push([key, "." + path]);
  }
  exports.sort((a, b) => a[0].localeCompare(b[0]));
  return exports;
}

// Collect all of the exports for each package.
const exportsByPackage = new Map<string, [string, string][]>();
for (const pkg of packages) {
  const exports = await discoverExports(pkg);
  exportsByPackage.set(pkg, exports);
}

const allExports: string[] = [];
for (const [pkg, exports] of exportsByPackage.entries()) {
  for (const [_, path] of exports) {
    allExports.push(join(pkg, path));
  }
}

const dataUrl = `data:application/javascript,` +
  allExports.map((path) => `import "file://${Deno.realPathSync(path)}";`).join(
    "",
  );
const out = await new Deno.Command(Deno.execPath(), {
  args: ["info", "--json", "--config", "deno.json", dataUrl],
}).output();
const graph = JSON.parse(new TextDecoder().decode(out.stdout));

const pkgDeps = new Map<string, Set<string>>(
  packages.map((pkg) => [pkg, new Set()]),
);
for (const { specifier, dependencies } of graph.modules) {
  if (!specifier.startsWith("file://")) continue;
  const from = relative(cwd, fromFileUrl(specifier));
  const fromPkg = from.split("/")[0];
  for (const dep of dependencies ?? []) {
    if (dep.code) {
      const to = relative(cwd, fromFileUrl(dep.code.specifier));
      const toPkg = to.split("/")[0];
      if (fromPkg !== toPkg) {
        pkgDeps.get(fromPkg)!.add(toPkg);
      }
    }
    if (dep.types) {
      const to = relative(cwd, fromFileUrl(dep.types.specifier));
      const toPkg = to.split("/")[0];
      if (fromPkg !== toPkg) {
        pkgDeps.get(fromPkg)!.add(toPkg);
      }
    }
  }
}

const orderedPackages: string[] = [];
const seen = new Set<string>();
function visit(pkg: string) {
  if (seen.has(pkg)) return;
  seen.add(pkg);
  for (const dep of pkgDeps.get(pkg)!) {
    visit(dep);
  }
  orderedPackages.push(pkg);
}
for (const pkg of packages) {
  visit(pkg);
}

// Now walk through all files, and replace relative imports between packages
// with absolute jsr imports like so:
// ```
// // cli/parse_args.ts
// import { assert } from "../assert/assert.ts";
// import * as path from "../path/mod.ts";
// ```
// becomes
// ```
// // cli/parse_args.ts
// import { assert } from "@std/assert/assert";
// import * as path from "@std/path";
// ```
// Also replace all absolute https://deno.land/std@$STD_VERSION/ imports with absolute jsr
// imports.
for await (const entry of walk(cwd)) {
  if (!entry.isFile) continue;
  if (entry.path.includes("/_tools")) continue; // ignore tools
  if (entry.path.includes("/testdata/")) continue; // ignore testdata

  if (!entry.path.endsWith(".md") && !entry.path.endsWith(".ts")) continue;
  const text = await Deno.readTextFile(entry.path);
  const currentUrl = toFileUrl(entry.path);
  const currentPkg = relative(cwd, entry.path).split("/")[0];

  // Find all relative imports.
  const relativeImportRegex = /from\s+["']\.?\.\/([^"']+)["']/g;
  const relativeImports = [];
  for (const match of text.matchAll(relativeImportRegex)) {
    relativeImports.push("../" + match[1]);
  }

  // Find all absolute imports.
  const absoluteImportRegex =
    /https:\/\/deno\.land\/std@\$STD_VERSION\/([^"'\s]+)/g;
  const absoluteImports = [];
  for (const match of text.matchAll(absoluteImportRegex)) {
    absoluteImports.push("https://deno.land/std@$STD_VERSION/" + match[1]);
  }

  const replacedImports: [string, string][] = [];

  for (const specifier of relativeImports) {
    const targetUrl = new URL(specifier, currentUrl);
    const path = fromFileUrl(targetUrl);
    const target = relative(cwd, path);
    const pkg = target.split("/")[0];
    if (pkg === currentPkg) {
      let newSpecifier = relative(dirname(entry.path), target);
      if (!newSpecifier.startsWith(".")) {
        newSpecifier = "./" + newSpecifier;
      }
      replacedImports.push([specifier, newSpecifier]);
    } else {
      const newSpecifier = "@std/" +
        target.replace(/(\.d)?\.ts$/, "").replace(/\/mod$/, "");
      replacedImports.push([specifier, newSpecifier]);
    }
  }

  for (const specifier of absoluteImports) {
    const target = specifier.replace(
      /^https:\/\/deno\.land\/std@\$STD_VERSION\//,
      "",
    );
    const newSpecifier = "@std/" +
      target.replace(/(\.d)?\.ts$/, "").replace(/\/mod$/, "");
    replacedImports.push([specifier, newSpecifier]);
  }

  // Replace all imports.
  let newText = text;
  for (const [oldSpecifier, newSpecifier] of replacedImports) {
    newText = newText.replace(oldSpecifier, newSpecifier);
  }

  // Write the file back.
  await Deno.writeTextFile(entry.path, newText);
}

// Generate `$package/deno.json` files.
for (const pkg of packages) {
  const exportsList = exportsByPackage.get(pkg)!;
  let exports;
  if (exportsList.length === 1 && exportsList[0][0] === ".") {
    exports = "./mod.ts";
  } else {
    exports = Object.fromEntries(exportsList);
  }
  const denoJson = {
    name: `@std/${pkg}`,
    version: VERSION,
    exports,
  };
  await Deno.writeTextFile(
    join(pkg, "deno.json"),
    JSON.stringify(denoJson, null, 2) + "\n",
  );
}

// Generate `deno.json` file.
const denoJson = JSON.parse(await Deno.readTextFile("deno.json"));
denoJson.workspaces = orderedPackages.map((pkg) => `./${pkg}`);
for (const pkg of packages) {
  denoJson.imports[`@std/${pkg}`] = `jsr:@std/${pkg}@^${VERSION}`;
  denoJson.imports[`@std/${pkg}/`] = `jsr:/@std/${pkg}@^${VERSION}/`;
}
await Deno.writeTextFile(
  "deno.json",
  JSON.stringify(denoJson, null, 2) + "\n",
);
