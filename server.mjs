import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = new URL("./", import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (m) => m.slice(1));
const port = Number(process.env.PORT || 4173);
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json" };

createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  const portalRoute = pathname === "/admin" || pathname === "/patient" || (/^\/[a-z0-9]+(?:-[a-z0-9]+)*\/?$/.test(pathname) && !pathname.includes("."));
  const requested = pathname === "/" ? "index.html" : portalRoute ? "portal.html" : pathname.slice(1);
  const file = normalize(join(root, requested));
  if (!file.startsWith(normalize(root))) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": `${types[extname(file)] || "application/octet-stream"}; charset=utf-8` });
    res.end(body);
  } catch {
    res.writeHead(404).end("Not found");
  }
}).listen(port, "127.0.0.1", () => console.log(`Healthcarology EHR: http://127.0.0.1:${port}`));
