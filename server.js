const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

const root = __dirname;
const dataFile = path.join(root, "storage.json");
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function readState() {
  try {
    return JSON.parse(await fsp.readFile(dataFile, "utf8"));
  } catch {
    return { users: [], predictions: {}, results: {} };
  }
}

const server = http.createServer(async (request, response) => {
  if (request.url === "/api/state" && request.method === "GET") {
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(await readState()));
    return;
  }

  if (request.url === "/api/state" && request.method === "POST") {
    const body = await readBody(request);
    const parsed = JSON.parse(body || "{}");
    const nextState = {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      predictions: parsed.predictions || {},
      results: parsed.results || {},
    };
    await fsp.writeFile(dataFile, JSON.stringify(nextState, null, 2));
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(nextState));
    return;
  }

  const pathname = decodeURIComponent(request.url.split("?")[0]);
  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(root, requested));

  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    response.writeHead(200, { "Content-Type": types[path.extname(filePath)] || "text/plain" });
    response.end(content);
  });
});

server.listen(4173, "0.0.0.0", () => {
  console.log("Porra Mundial 2026 disponible en http://127.0.0.1:4173");
  console.log("En otros dispositivos de la misma WiFi, abre http://IP-DE-ESTE-ORDENADOR:4173");
});
