"use strict";
// Usage: npm pack mathjax@3.2.2 --ignore-scripts, extract the archive, then
// node scripts/vendor-mathjax.cjs /absolute/path/to/extracted/package
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const version = "3.2.2", source = path.resolve(process.argv[2] || ""),
  destination = path.join(__dirname, "..", "public", "vendor", `mathjax-${version}`);
if (!process.argv[2] || JSON.parse(fs.readFileSync(path.join(source,"package.json"),"utf8")).version !== version) throw Error("An extracted official MathJax 3.2.2 npm package is required.");
const files = {};
function copy(relative) {
  const input = path.join(source,relative), stat = fs.lstatSync(input);
  if (stat.isDirectory()) { for (const name of fs.readdirSync(input).sort()) copy(`${relative}/${name}`); return; }
  if (!stat.isFile()) throw Error(`Unexpected MathJax file: ${relative}`);
  const bytes = fs.readFileSync(input), output = path.join(destination,relative);
  fs.mkdirSync(path.dirname(output),{recursive:true});
  fs.writeFileSync(output,bytes);
  files[relative] = crypto.createHash("sha256").update(bytes).digest("hex");
}
copy("es5"); copy("LICENSE");
fs.writeFileSync(path.join(destination,"SOURCE.json"),JSON.stringify({name:"mathjax",version,
  source:`https://registry.npmjs.org/mathjax/-/mathjax-${version}.tgz`,
  npmIntegrity:"sha512-Bt+SSVU8eBG27zChVewOicYs7Xsdt40qm4+UpHyX7k0/O9NliPc+x77k1/FEsPsjKPZGJvtRZM1vO+geW0OhGw==",files},null,2)+"\n");
console.log(`Vendored MathJax ${version}: ${Object.keys(files).length} files.`);
