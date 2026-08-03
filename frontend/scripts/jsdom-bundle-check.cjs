const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { JSDOM, VirtualConsole } = require("jsdom");

const buildDir = path.join(__dirname, "..", "build");
const htmlPath = path.join(buildDir, "index.html");
const html = fs.readFileSync(htmlPath, "utf8");
const jsMatch = html.match(/src="(\/static\/js\/[^"]+)"/);
if (!jsMatch) {
  console.error("No JS bundle in index.html");
  process.exit(1);
}
const jsPath = path.join(buildDir, jsMatch[1].replace(/^\//, "").replace(/\//g, path.sep));
const jsUrl = pathToFileURL(jsPath).href;

const errors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on("error", (...args) => errors.push(args.join(" ")));
virtualConsole.on("jsdomError", (e) => errors.push(e.message || String(e)));

const dom = new JSDOM(
  `<!DOCTYPE html><html><head></head><body><div id="root"></div><script src="${jsUrl}"></script></body></html>`,
  {
    url: "http://localhost/",
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
    virtualConsole,
  },
);

setTimeout(() => {
  const rootLen = dom.window.document.getElementById("root")?.innerHTML?.length || 0;
  console.log(
    JSON.stringify(
      {
        bundle: path.basename(jsPath),
        rootHtmlLength: rootLen,
        errors: errors.slice(0, 20),
      },
      null,
      2,
    ),
  );
  process.exit(rootLen > 100 ? 0 : 1);
}, 8000);
