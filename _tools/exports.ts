const exports: [string, string][] = [];

const folder = Deno.args[0];
const folders = [folder];
for (let i = 0; i < folders.length; i++) {
  const prefix = folders[i].split("/").slice(1).join("/");
  for await (const entry of Deno.readDir(folders[i])) {
    if (
      entry.name.startsWith(".") || entry.name.startsWith("_") ||
      entry.name.endsWith("_test.ts") || entry.name.endsWith(".json") ||
      entry.name === "test.ts" || entry.name.endsWith(".md")
    ) continue;
    let name = entry.name.replace(".ts", "");
    if (name === "mod") {
      if (prefix) {
        name = prefix;
      } else {
        name = "";
      }
    } else if (prefix) name = `${prefix}/${name}`;
    if (name === "") {
      name = ".";
    } else {
      name = "./" + name;
    }
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isFile) exports.push([name, `./${path}`]);
    if (
      entry.isDirectory && entry.name !== "testdata" && entry.name !== "example"
    ) {
      folders.push(folder + "/" + path);
    }
  }
}
exports.sort((a, b) => a[0].localeCompare(b[0]));

const denoJsonPath = `./${folder}/deno.json`;
const denoJson = JSON.parse(await Deno.readTextFile(denoJsonPath));
denoJson.exports = Object.fromEntries(exports);
await Deno.writeTextFile(denoJsonPath, JSON.stringify(denoJson, null, 2));
