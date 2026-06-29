// Vercel serverless function: transcodes a Notion-hosted image to JPEG so the
// browser can render it inline. Notion serves iPhone uploads as HEIC, which no
// non-Safari browser can display, so the matrix points HEIC <img>/<a> at this
// route (see webImageUrl in api/index.js) instead of the raw file.
//
// The source is an AWS presigned S3 url. Third-party image proxies can't fetch
// these — the encoded-slash signature params get mangled — so we fetch them
// ourselves, signature intact, and transcode.
//
// iPhone HEICs are HEVC-compressed, which sharp's prebuilt libvips can't decode
// (no HEVC plugin, for licensing reasons). So heic-convert (pure JS, bundles the
// decoder) handles the decode, then sharp downsizes the full-resolution phone
// photo to a lean web JPEG.

const convert = require('heic-convert');
const sharp = require('sharp');

// Only fetch from hosts Notion actually serves files from. Without this the
// route would be an open image proxy and SSRF vector.
function allowedHost(host) {
  return /(^|\.)amazonaws\.com$/.test(host) ||
    /(^|\.)notion\.so$/.test(host) ||
    /(^|\.)notion-static\.com$/.test(host);
}

module.exports = async function handler(req, res) {
  const u = new URL(req.url, 'http://localhost').searchParams.get('u');
  if (!u) { res.statusCode = 400; res.end('Missing u parameter.'); return; }

  let target;
  try { target = new URL(u); } catch (e) {
    res.statusCode = 400; res.end('Malformed u parameter.'); return;
  }
  if (target.protocol !== 'https:' || !allowedHost(target.hostname)) {
    res.statusCode = 400; res.end('Source host not allowed.'); return;
  }

  try {
    const upstream = await fetch(target.href);
    if (!upstream.ok) {
      res.statusCode = 502;
      res.end('Source returned HTTP ' + upstream.status + '.');
      return;
    }
    const input = Buffer.from(await upstream.arrayBuffer());
    // heic-convert decodes the HEVC bitstream (applying the file's orientation);
    // sharp then bounds the multi-thousand-pixel phone photo to a web size.
    const decoded = Buffer.from(await convert({ buffer: input, format: 'JPEG', quality: 1 }));
    const jpeg = await sharp(decoded)
      .rotate()
      .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
    res.setHeader('Content-Type', 'image/jpeg');
    // The presigned url in `u` is unique per page load and its bytes never
    // change, so an identical url can be served straight from cache.
    res.setHeader('Cache-Control', 'public, max-age=3600, immutable');
    res.statusCode = 200;
    res.end(jpeg);
  } catch (err) {
    res.statusCode = 502;
    res.end('Could not transcode image: ' + (err && err.message ? err.message : 'unknown error') + '.');
  }
};
