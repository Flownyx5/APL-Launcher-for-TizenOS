/* ============================================================
   qr.js: a small QR code encoder (byte mode, error correction M,
   versions 1 to 10: up to 216 characters, plenty for the address of the
   phone setup page). Written from the QR code standard (ISO 18004).
   TV.qr.matrix(text) -> array of rows of booleans (true = dark)
   TV.qr.canvas(text, px) -> <canvas> with a 4-module quiet zone
   ============================================================ */
(function (global) {
    "use strict";

    // Error correction M: [EC codewords per block, blocks of group 1, data per block, blocks of group 2, data per block]
    var EC_M = [null, [10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0], [18, 2, 32, 0, 0], [24, 2, 43, 0, 0],
                [16, 4, 27, 0, 0], [18, 4, 31, 0, 0], [22, 2, 38, 2, 39], [22, 3, 36, 2, 37], [26, 4, 43, 1, 44]];
    var ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

    function utf8(s) {
        var out = [];
        for (var i = 0; i < s.length; i++) {
            var c = s.charCodeAt(i);
            if (c < 0x80) out.push(c);
            else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
            else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
        }
        return out;
    }
    function gmul(x, y) {
        var z = 0;
        for (var i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; }
        return z & 0xff;
    }
    function rsDivisor(deg) {
        var r = []; for (var i = 0; i < deg - 1; i++) r.push(0); r.push(1);
        var root = 1;
        for (i = 0; i < deg; i++) {
            for (var j = 0; j < r.length; j++) { r[j] = gmul(r[j], root); if (j + 1 < r.length) r[j] ^= r[j + 1]; }
            root = gmul(root, 2);
        }
        return r;
    }
    function rsRemainder(data, div) {
        var r = div.map(function () { return 0; });
        data.forEach(function (b) {
            var f = b ^ r.shift(); r.push(0);
            for (var i = 0; i < div.length; i++) r[i] ^= gmul(div[i], f);
        });
        return r;
    }

    function encode(text) {
        var bytes = utf8(String(text)), ver = 0, e;
        for (var v = 1; v <= 10; v++) {
            e = EC_M[v];
            var cap = e[1] * e[2] + e[3] * e[4];
            if (4 + (v < 10 ? 8 : 16) + bytes.length * 8 <= cap * 8) { ver = v; break; }
        }
        if (!ver) throw new Error("text too long for a QR code");
        e = EC_M[ver];
        var dataLen = e[1] * e[2] + e[3] * e[4], bits = [];
        function put(val, n) { for (var i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); }
        put(4, 4); put(bytes.length, ver < 10 ? 8 : 16);
        bytes.forEach(function (b) { put(b, 8); });
        put(0, Math.min(4, dataLen * 8 - bits.length));
        while (bits.length % 8) bits.push(0);
        var data = [];
        for (var i = 0; i < bits.length; i += 8) { var b = 0; for (var j = 0; j < 8; j++) b = (b << 1) | bits[i + j]; data.push(b); }
        for (var pad = 0xec; data.length < dataLen; pad ^= 0xec ^ 0x11) data.push(pad);

        // Blocks, error correction, interleaving
        var blocks = [], ecc = [], div = rsDivisor(e[0]), k = 0;
        for (i = 0; i < e[1] + e[3]; i++) {
            var n = i < e[1] ? e[2] : e[4], blk = data.slice(k, k + n);
            k += n; blocks.push(blk); ecc.push(rsRemainder(blk, div));
        }
        var words = [], maxLen = Math.max(e[2], e[4]);
        for (i = 0; i < maxLen; i++) blocks.forEach(function (bl) { if (i < bl.length) words.push(bl[i]); });
        for (i = 0; i < e[0]; i++) ecc.forEach(function (ec) { words.push(ec[i]); });
        return { ver: ver, words: words };
    }

    function matrix(text) {
        var enc = encode(text), ver = enc.ver, size = 17 + ver * 4;
        var mod = [], fn = [];
        for (var y = 0; y < size; y++) { mod.push([]); fn.push([]); for (var x = 0; x < size; x++) { mod[y].push(false); fn[y].push(false); } }
        function set(x, y, dark) { mod[y][x] = dark; fn[y][x] = true; }

        for (var i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
        function finder(cx, cy) {
            for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
                var d = Math.max(Math.abs(dx), Math.abs(dy)), xx = cx + dx, yy = cy + dy;
                if (xx >= 0 && xx < size && yy >= 0 && yy < size) set(xx, yy, d !== 2 && d !== 4);
            }
        }
        finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
        var al = ALIGN[ver], last = al.length - 1;
        for (i = 0; i < al.length; i++) for (var j = 0; j < al.length; j++) {
            if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
            for (var dy2 = -2; dy2 <= 2; dy2++) for (var dx2 = -2; dx2 <= 2; dx2++) set(al[i] + dx2, al[j] + dy2, Math.max(Math.abs(dx2), Math.abs(dy2)) !== 1);
        }
        function format(mask) {
            var d = (0 << 3) | mask, rem = d;               // M = 00
            for (var q = 0; q < 10; q++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
            var b = ((d << 10) | rem) ^ 0x5412;
            function bit(n) { return ((b >>> n) & 1) !== 0; }
            for (q = 0; q <= 5; q++) set(8, q, bit(q));
            set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
            for (q = 9; q < 15; q++) set(14 - q, 8, bit(q));
            for (q = 0; q < 8; q++) set(size - 1 - q, 8, bit(q));
            for (q = 8; q < 15; q++) set(8, size - 15 + q, bit(q));
            set(8, size - 8, true);
        }
        format(0);
        if (ver >= 7) {
            var rem = ver;
            for (i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
            var vb = (ver << 12) | rem;
            for (i = 0; i < 18; i++) {
                var c = ((vb >>> i) & 1) !== 0, a = size - 11 + (i % 3), bb = Math.floor(i / 3);
                set(a, bb, c); set(bb, a, c);
            }
        }
        // Data, in the zigzag order of the standard
        var words = enc.words, bi = 0;
        for (var right = size - 1; right >= 1; right -= 2) {
            if (right === 6) right = 5;
            for (var vert = 0; vert < size; vert++) for (var jj = 0; jj < 2; jj++) {
                var xx = right - jj, up = ((right + 1) & 2) === 0, yy = up ? size - 1 - vert : vert;
                if (!fn[yy][xx] && bi < words.length * 8) { mod[yy][xx] = ((words[bi >>> 3] >>> (7 - (bi & 7))) & 1) !== 0; bi++; }
            }
        }
        function applyMask(m) {
            for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) {
                if (fn[y][x]) continue;
                var inv;
                switch (m) {
                    case 0: inv = (x + y) % 2 === 0; break;
                    case 1: inv = y % 2 === 0; break;
                    case 2: inv = x % 3 === 0; break;
                    case 3: inv = (x + y) % 3 === 0; break;
                    case 4: inv = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
                    case 5: inv = (x * y) % 2 + (x * y) % 3 === 0; break;
                    case 6: inv = ((x * y) % 2 + (x * y) % 3) % 2 === 0; break;
                    default: inv = ((x + y) % 2 + (x * y) % 3) % 2 === 0;
                }
                if (inv) mod[y][x] = !mod[y][x];
            }
        }
        function penalty() {
            var p = 0, dark = 0, x, y, run, c;
            for (y = 0; y < size; y++) {
                run = 1;
                for (x = 1; x <= size; x++) {
                    if (x < size && mod[y][x] === mod[y][x - 1]) run++;
                    else { if (run >= 5) p += run - 2; run = 1; }
                }
            }
            for (x = 0; x < size; x++) {
                run = 1;
                for (y = 1; y <= size; y++) {
                    if (y < size && mod[y][x] === mod[y - 1][x]) run++;
                    else { if (run >= 5) p += run - 2; run = 1; }
                }
            }
            for (y = 0; y < size - 1; y++) for (x = 0; x < size - 1; x++) {
                c = mod[y][x];
                if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) p += 3;
            }
            for (y = 0; y < size; y++) for (x = 0; x < size; x++) if (mod[y][x]) dark++;
            p += Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
            return p;
        }
        var best = 0, bestP = Infinity;
        for (var m = 0; m < 8; m++) {
            applyMask(m); format(m);
            var pp = penalty();
            if (pp < bestP) { bestP = pp; best = m; }
            applyMask(m);
        }
        applyMask(best); format(best);
        return mod;
    }

    function canvas(text, px) {
        var m = matrix(text), n = m.length, q = 4, scale = Math.max(1, Math.floor((px || 400) / (n + q * 2)));
        var cv = document.createElement("canvas");
        cv.width = cv.height = (n + q * 2) * scale;
        var g = cv.getContext("2d");
        g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height);
        g.fillStyle = "#000";
        for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) if (m[y][x]) g.fillRect((x + q) * scale, (y + q) * scale, scale, scale);
        return cv;
    }

    global.TV = global.TV || {};
    global.TV.qr = { matrix: matrix, canvas: canvas };
})(typeof window !== "undefined" ? window : this);
