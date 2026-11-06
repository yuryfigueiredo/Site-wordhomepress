/* find-photo.js — busca foto real para a matéria com fallback Unsplash → Pexels.
   Salva em images/posts/<slug>.jpg e retorna { url, author, credit }.
   Uso: const foto = await findPhoto(slug, query, category);
   Requer: UNSPLASH_ACCESS_KEY e PEXELS_API_KEY no .env ou process.env. */

const fs = require("fs");
const path = require("path");
const https = require("https");

const ROOT = path.resolve(__dirname, "../..");
const OUT_DIR = path.join(ROOT, "images", "posts");

/* Carrega .env manualmente (sem dependência dotenv). */
const envFile = path.join(ROOT, ".env");
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#"))
    .forEach((l) => {
      const [k, ...v] = l.split("=");
      if (k && v.length) process.env[k.trim()] = v.join("=").trim();
    });
}

/* Download de imagem com timeout. */
const download = (url, outPath, timeoutMs = 8000) =>
  new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const stream = fs.createWriteStream(outPath);
      res.pipe(stream);
      stream.on("finish", () => { stream.close(); resolve(outPath); });
      stream.on("error", reject);
    });
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error("timeout")); });
    req.on("error", reject);
  });

/* Busca no Unsplash: retorna { url, author, credit } ou null. */
async function searchUnsplash(query) {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) return null;
  const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=1&orientation=landscape`;
  const res = await fetch(url, { headers: { Authorization: `Client-ID ${key}` } });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.results || !data.results.length) return null;
  const photo = data.results[0];
  return {
    url: photo.urls.regular,
    author: photo.user.name,
    credit: `Photo by ${photo.user.name} on Unsplash`,
    download: photo.urls.regular.replace("w=1080", "w=1200"),
  };
}

/* Busca no Pexels: retorna { url, author, credit } ou null. */
async function searchPexels(query) {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return null;
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1&orientation=landscape`;
  const res = await fetch(url, { headers: { Authorization: key } });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.photos || !data.photos.length) return null;
  const photo = data.photos[0];
  return {
    url: photo.src.large2x,
    author: photo.photographer,
    credit: `Photo by ${photo.photographer} from Pexels`,
    download: photo.src.large2x,
  };
}

/* Busca com fallback: Unsplash → Pexels → null. */
async function findPhoto(slug, query, category) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, `${slug}.jpg`);

  /* Tenta Unsplash primeiro. */
  let result = await searchUnsplash(query);
  if (result) {
    await download(result.download, outPath);
    return { local: `images/posts/${slug}.jpg`, ...result };
  }

  /* Fallback para Pexels. */
  result = await searchPexels(query);
  if (result) {
    await download(result.download, outPath);
    return { local: `images/posts/${slug}.jpg`, ...result };
  }

  return null;
}

module.exports = { findPhoto };
