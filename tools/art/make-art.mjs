// ============================================================
//  make-art.mjs — generates, for each app in tools/art/apps.json:
//    launcher/images/apps/<key>-tile.png  (500x300, tile in the style of a tvOS icon)
//  then rewrites launcher/js/catalog.js.
//
//  Logo sources (free, no key):
//    di:<name>  -> github.com/homarr-labs/dashboard-icons (colour PNG)
//    si:<slug>  -> simple-icons (npm, official brand SVGs)
//    sh:<name>  -> github.com/selfhst/icons (colour PNG)
//    tv:<country/name> -> github.com/tv-logo/tv-logos (official channel logos)
//    url:<https://…> -> direct file (e.g. the official icon of a GitHub project)
//    file:<name> -> supplied logo, in tools/art/logos/
//  Logo options: white (recolour in white), knockout (colour to make
//  transparent), crop (trim the margins), rotate (90/180/270), suffix
//  (text placed alongside, e.g. "+" for TF1+), icon (square app icon: a tile with
//  a gradient taken from the icon, like a tvOS icon).
//
//  Prerequisites (once):
//    cd tools/art && npm i playwright simple-icons @fontsource/inter
//    npx playwright install chromium
//  Then:
//    node tools/art/make-art.mjs
//  Options: --cache <dir> (logos already downloaded), --only netflix,plex
// ============================================================

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
// By default: the apps. With --spec devices.json: the devices (Sources).
const argv = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const SPEC = argv("--spec") || "apps.json";
const OUT = join(ROOT, "launcher", "images", argv("--out") || "apps");
const CATALOG = join(ROOT, "launcher", "js", argv("--catalog") || "catalog.js");
const VAR = argv("--var") || "APL_CATALOG";
const require = createRequire(join(HERE, "package.json"));

const arg = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const CACHE = resolve(arg("--cache") || join(HERE, ".cache"));
const ONLY = (arg("--only") || "").split(",").filter(Boolean);
mkdirSync(OUT, { recursive: true });
mkdirSync(CACHE, { recursive: true });

const { chromium } = require("playwright");
// Folder of an installed package (some don't export package.json).
function pkgDir(name) {
  const p = require.resolve(name).split("\\").join("/");
  const marker = "/node_modules/" + name + "/";
  return p.slice(0, p.lastIndexOf(marker) + marker.length - 1);
}
const SI_DIR = pkgDir("simple-icons") + "/icons";
const FONT_DIR = pkgDir("@fontsource/inter") + "/files";
const SPEC_ALL = JSON.parse(readFileSync(join(HERE, SPEC), "utf8"));
const spec = SPEC_ALL.apps.filter((a) => !ONLY.length || ONLY.includes(a.key));
// Backgrounds only (no tile or catalogue entry) for the apps described in apps.js (TizenTube…)

const b64 = (buf) => Buffer.from(buf).toString("base64");

const REMOTE = {
  di: (n) => `https://raw.githubusercontent.com/homarr-labs/dashboard-icons/main/png/${n}.png`,
  sh: (n) => `https://raw.githubusercontent.com/selfhst/icons/main/png/${n}.png`,
  tv: (n) => `https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/${n}.png`,
  url: (n) => n,
};

async function logoDataUrl(logo) {
  const i = logo.src.indexOf(":");
  const kind = logo.src.slice(0, i), name = logo.src.slice(i + 1);
  if (kind === "si") {
    let svg = readFileSync(join(SI_DIR, name + ".svg"), "utf8");
    // Explicit size: otherwise the SVG (viewBox 24×24) is rasterised at 24 px for cropping.
    svg = svg.replace("<svg ", `<svg width="1024" height="1024" fill="${logo.white ? "#ffffff" : (logo.color || "#000000")}" `);
    return "data:image/svg+xml;base64," + b64(svg);
  }
  if (kind === "file") {
    // Supplied logo (tools/art/logos/…), e.g. FRAnime, Movix
    const f = join(HERE, "logos", name), buf = readFileSync(f);
    return (name.endsWith(".svg") ? "data:image/svg+xml;base64," : "data:image/png;base64,") + b64(buf);
  }
  if (!REMOTE[kind]) throw new Error("unknown source: " + logo.src);
  // di-<name>.png keeps the names of files already in the cache.
  const file = join(CACHE, `${kind}-${name.replace(/^https?:\/\//, "").replace(/[^A-Za-z0-9._-]+/g, "_")}`.replace(/(\.png)?$/, ".png"));
  if (!existsSync(file)) {
    const url = REMOTE[kind](name);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  return "data:image/png;base64," + b64(readFileSync(file));
}

const fontCss = [700, 800].map((w) =>
  `@font-face{font-family:Inter;font-weight:${w};src:url(data:font/woff2;base64,${b64(readFileSync(join(FONT_DIR, `inter-latin-${w}-normal.woff2`)))}) format("woff2")}`
).join("");

function hexToRgb(h) { h = h.replace("#", ""); return [0, 2, 4].map((i) => parseInt(h.substr(i, 2), 16)); }
function isLight(hex) { if (!hex.startsWith("#")) return false; const [r, g, b] = hexToRgb(hex); return (r * 299 + g * 587 + b * 114) / 1000 > 160; }

// Prepares the logo in the page: cut-out (knockout) + cropping.
const PREP = `
async function prep(src, knockout, crop, rotate) {
  let img = new Image(); img.src = src; await img.decode();
  if (rotate) {
    const r = document.createElement('canvas'), q = rotate % 180 !== 0;
    r.width = q ? img.naturalHeight : img.naturalWidth; r.height = q ? img.naturalWidth : img.naturalHeight;
    const rx = r.getContext('2d'); rx.translate(r.width / 2, r.height / 2); rx.rotate(rotate * Math.PI / 180);
    rx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    img = new Image(); img.src = r.toDataURL(); await img.decode(); src = img.src;
  }
  if (!knockout && !crop) return src;
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height), p = d.data;
  const k = knockout ? knockout.replace('#','').match(/../g).map(h => parseInt(h, 16)) : null;
  let minX = c.width, minY = c.height, maxX = 0, maxY = 0;
  for (let i = 0; i < p.length; i += 4) {
    if (k) {
      const dist = Math.max(Math.abs(p[i]-k[0]), Math.abs(p[i+1]-k[1]), Math.abs(p[i+2]-k[2]));
      p[i+3] = Math.min(p[i+3], Math.min(255, Math.max(0, (dist - 12) * 5)));
    }
    if (p[i+3] > 40) { const px = (i/4) % c.width, py = Math.floor(i/4/c.width);
      if (px<minX)minX=px; if(px>maxX)maxX=px; if(py<minY)minY=py; if(py>maxY)maxY=py; }
  }
  x.putImageData(d, 0, 0);
  if (!crop) return c.toDataURL();
  const o = document.createElement('canvas'); o.width = maxX-minX+1; o.height = maxY-minY+1;
  o.getContext('2d').drawImage(c, minX, minY, o.width, o.height, 0, 0, o.width, o.height);
  return o.toDataURL();
}
// Colours of a square icon: top-left and bottom-right corners (14% in from the edge).
async function iconColours(src) {
  const img = new Image(); img.src = src; await img.decode();
  const c = document.createElement('canvas'); c.width = c.height = 50;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0, 50, 50);
  const at = (px, py) => { const d = x.getImageData(px, py, 1, 1).data; return 'rgb(' + d[0] + ',' + d[1] + ',' + d[2] + ')'; };
  return [at(9, 9), at(41, 41), at(25, 6), at(25, 44)];
}`;

function sizeCss(s, boxW, boxH) {
  if (s.w) return `width:${s.w <= 1 ? s.w * boxW : s.w}px;height:auto`;
  return `height:${s.h <= 1 ? s.h * boxH : s.h}px;width:auto`;
}

function suffixHtml(app, px, bg) {
  const sx = app.logo.suffix;
  if (!sx) return "";
  return `<span style="font:800 ${Math.round(px)}px/1 Inter,sans-serif;color:${isLight(bg) ? "#111" : "#fff"};margin-left:${Math.round(px * 0.06)}px;align-self:center">${sx}</span>`;
}

function logoPx(s, boxW, boxH) { return s.h ? (s.h <= 1 ? s.h * boxH : s.h) : (s.w <= 1 ? s.w * boxW : s.w) * 0.4; }

function tileHtml(app) {
  const t = app.tile;
  if (app.logo.icon) {
    // Square app icon: extended by its own gradient (or by tile.bg), with faded edges.
    return `<div id="tile" style="width:500px;height:300px;display:flex;align-items:center;justify-content:center;overflow:hidden;background:${t.bg || "#222"}">
      <img id="logo" style="height:${Math.round((t.h || 1.08) * 300)}px;width:auto;-webkit-mask-image:radial-gradient(closest-side,#000 74%,transparent 100%)"></div>`;
  }
  return `<div id="tile" style="width:500px;height:300px;display:flex;align-items:center;justify-content:center;background:${t.bg}">
    <img id="logo" style="${sizeCss(t, 500, 300)};max-width:84%;max-height:80%;object-fit:contain;${app.logo.white ? "filter:brightness(0) invert(1);" : ""}">${suffixHtml(app, logoPx(t, 500, 300) * 0.9, t.bg || "#000")}</div>`;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const catalog = [];

for (const app of spec) {
  try {
    const raw = await logoDataUrl(app.logo);
    // The Top Shelf backgrounds are made on the screen (launcher/js/genart.js): tiles only here
    for (const kind of ["tile"]) {
      await page.setContent(`<html><head><style>${fontCss}body{margin:0}</style></head><body>${tileHtml(app)}<script>${PREP}</script></body></html>`);
      await page.evaluate(async ({ raw, ko, crop, rot, icon, kind, tileBg }) => {
        const url = await prep(raw, ko, crop, rot);
        const img = document.getElementById("logo");
        if (img) { img.src = url; await img.decode(); }
        if (icon && kind === "tile" && !tileBg) {
          const [tl, br] = await iconColours(url);
          document.getElementById("tile").style.background = `linear-gradient(135deg, ${tl} 0%, ${br} 100%)`;
        }
        await document.fonts.ready;
      }, { raw, ko: app.logo.knockout || null, crop: !!app.logo.crop, rot: app.logo.rotate || 0, icon: !!app.logo.icon, kind, tileBg: !!(app.tile && app.tile.bg) });
      await (await page.$("#tile")).screenshot({ path: join(OUT, `${app.key}-tile.png`) });
    }
    const dir = "images/" + (argv("--out") || "apps");
    catalog.push({ key: app.key, name: app.name, eyebrow: app.eyebrow, accent: app.accent,
      match: app.match, ids: app.ids, tile: `${dir}/${app.key}-tile.png`,
      ...(app.system ? { system: true } : {}), ...(app.hide ? { hide: true } : {}), ...(app.live ? { live: app.live } : {}) });
    console.log("✓", app.name);
  } catch (e) {
    console.log("✗", app.name, "-", e.message);
  }
}
await browser.close();

if (!ONLY.length) {
  writeFileSync(CATALOG,
`/* ============================================================
   ${CATALOG.split(/[\\/]/).pop()} — generated logos.
   GENERATED by tools/art/make-art.mjs from tools/art/${SPEC}.
   An app is recognised by its Tizen id (ids) or by its
   name (match, regular expressions on the lowercase name).
   ============================================================ */
window.${VAR} = ${JSON.stringify(catalog, null, 2)};
`);
  console.log(`catalog.js: ${catalog.length} apps`);
}
