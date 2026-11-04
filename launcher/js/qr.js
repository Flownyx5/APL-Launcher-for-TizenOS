/* ============================================================
   qr.js — a small QR code generator (byte mode, versions 1 to 10).

   Enough for an address of up to ~200 characters, drawn as SVG.
   Follows the QR Code standard (ISO/IEC 18004): Reed-Solomon over
   GF(256), interleaved blocks, the 8 masks with their penalty, format
   and version information. Written for the phone remote (phone.js):
   no library to download, nothing leaves the screen.
     APL.qrSvg("http://192.168.1.11:8092/?t=…", 360) -> "<svg …>"
   ============================================================ */
(function (global) {
    "use strict";

    /* Error correction: [codewords per block, number of blocks] for versions 1-10 (index = version). */
    var ECC = {
        L: { per: [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18], blocks: [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4], bits: 1 },
        M: { per: [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26], blocks: [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5], bits: 0 }
    };

    function rawModules(ver) {
        var r = (16 * ver + 128) * ver + 64;
        if (ver >= 2) {
            var n = Math.floor(ver / 7) + 2;
            r -= (25 * n - 10) * n - 55;
            if (ver >= 7) r -= 36;
        }
        return r;
    }
    function dataCodewords(ver, e) { return Math.floor(rawModules(ver) / 8) - e.per[ver] * e.blocks[ver]; }

    /* ---------- Reed-Solomon ---------- */
    function mul(x, y) {
        var z = 0;
        for (var i = 7; i >= 0; i--) {
            z = (z << 1) ^ ((z >>> 7) * 0x11D);
            z ^= ((y >>> i) & 1) * x;
        }
        return z & 0xFF;
    }
    function divisor(degree) {
        var r = [];
        for (var i = 0; i < degree - 1; i++) r.push(0);
        r.push(1);
        var root = 1;
        for (i = 0; i < degree; i++) {
            for (var j = 0; j < r.length; j++) {
                r[j] = mul(r[j], root);
                if (j + 1 < r.length) r[j] ^= r[j + 1];
            }
            root = mul(root, 0x02);
        }
        return r;
    }
    function remainder(data, div) {
        var r = div.map(function () { return 0; });
        data.forEach(function (b) {
            var f = b ^ r.shift();
            r.push(0);
            for (var i = 0; i < r.length; i++) r[i] ^= mul(div[i], f);
        });
        return r;
    }

    /* ---------- encoding ---------- */
    function utf8(s) {
        var out = [], t = unescape(encodeURIComponent(s));
        for (var i = 0; i < t.length; i++) out.push(t.charCodeAt(i));
        return out;
    }

    function encode(text, level) {
        var e = ECC[level || "M"], bytes = utf8(text), ver;
        for (ver = 1; ver <= 10; ver++) {
            var countBits = ver < 10 ? 8 : 16;
            if (4 + countBits + bytes.length * 8 <= dataCodewords(ver, e) * 8) break;
        }
        if (ver > 10) throw new Error("text too long for a QR code");
        var bits = [];
        function put(v, n) { for (var i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); }
        put(4, 4);                                   // byte mode
        put(bytes.length, ver < 10 ? 8 : 16);
        bytes.forEach(function (b) { put(b, 8); });
        var cap = dataCodewords(ver, e) * 8;
        put(0, Math.min(4, cap - bits.length));      // terminator
        put(0, (8 - bits.length % 8) % 8);
        var data = [];
        for (var i = 0; i < bits.length; i += 8) {
            var v = 0;
            for (var k = 0; k < 8; k++) v = (v << 1) | bits[i + k];
            data.push(v);
        }
        for (var pad = 0xEC; data.length < cap / 8; pad ^= 0xEC ^ 0x11) data.push(pad);

        // Blocks, error correction, interleaving
        var nb = e.blocks[ver], eccLen = e.per[ver], raw = Math.floor(rawModules(ver) / 8);
        var nShort = nb - raw % nb, shortLen = Math.floor(raw / nb), div = divisor(eccLen), blocks = [], at = 0;
        for (i = 0; i < nb; i++) {
            var dat = data.slice(at, at + shortLen - eccLen + (i < nShort ? 0 : 1));
            at += dat.length;
            var ecc = remainder(dat, div);
            if (i < nShort) dat.push(0);
            blocks.push(dat.concat(ecc));
        }
        var all = [];
        for (i = 0; i < blocks[0].length; i++) {
            for (var j = 0; j < blocks.length; j++) {
                if (i !== shortLen - eccLen || j >= nShort) all.push(blocks[j][i]);
            }
        }
        return draw(ver, e, all);
    }

    /* ---------- the matrix ---------- */
    function draw(ver, e, codewords) {
        var size = ver * 4 + 17, mod = [], fn = [];
        for (var y = 0; y < size; y++) {
            mod.push([]); fn.push([]);
            for (var x = 0; x < size; x++) { mod[y].push(false); fn[y].push(false); }
        }
        function set(x, y, dark) { mod[y][x] = dark; fn[y][x] = true; }

        for (var i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }    // timing
        [[3, 3], [size - 4, 3], [3, size - 4]].forEach(function (c) {                          // finders
            for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
                var d = Math.max(Math.abs(dx), Math.abs(dy)), xx = c[0] + dx, yy = c[1] + dy;
                if (xx >= 0 && xx < size && yy >= 0 && yy < size) set(xx, yy, d !== 2 && d !== 4);
            }
        });
        var pos = [];                                                                           // alignment
        if (ver > 1) {
            var n = Math.floor(ver / 7) + 2, step = Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
            pos = [6];
            for (var p = size - 7; pos.length < n; p -= step) pos.splice(1, 0, p);
        }
        pos.forEach(function (ay, a) {
            pos.forEach(function (ax, b) {
                if ((a === 0 && b === 0) || (a === 0 && b === pos.length - 1) || (a === pos.length - 1 && b === 0)) return;
                for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
            });
        });
        formatBits(0);                                                                          // reserved for now
        if (ver >= 7) {
            var rem = ver;
            for (i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
            var vb = (ver << 12) | rem;
            for (i = 0; i < 18; i++) {
                var bit = ((vb >>> i) & 1) === 1, a2 = size - 11 + i % 3, b2 = Math.floor(i / 3);
                set(a2, b2, bit); set(b2, a2, bit);
            }
        }

        function formatBits(mask) {
            var d = (e.bits << 3) | mask, r = d;
            for (var k = 0; k < 10; k++) r = (r << 1) ^ ((r >>> 9) * 0x537);
            var b = ((d << 10) | r) ^ 0x5412;
            function g(k) { return ((b >>> k) & 1) === 1; }
            for (k = 0; k <= 5; k++) set(8, k, g(k));
            set(8, 7, g(6)); set(8, 8, g(7)); set(7, 8, g(8));
            for (k = 9; k < 15; k++) set(14 - k, 8, g(k));
            for (k = 0; k < 8; k++) set(size - 1 - k, 8, g(k));
            for (k = 8; k < 15; k++) set(8, size - 15 + k, g(k));
            set(8, size - 8, true);
            return b;
        }

        // Data, in the zigzag order of the standard
        var bitAt = 0, total = codewords.length * 8;
        for (var right = size - 1; right >= 1; right -= 2) {
            if (right === 6) right = 5;
            for (var vert = 0; vert < size; vert++) {
                for (var j = 0; j < 2; j++) {
                    var cx = right - j, up = ((right + 1) & 2) === 0, cy = up ? size - 1 - vert : vert;
                    if (!fn[cy][cx] && bitAt < total) {
                        mod[cy][cx] = ((codewords[bitAt >>> 3] >>> (7 - (bitAt & 7))) & 1) === 1;
                        bitAt++;
                    }
                }
            }
        }

        function masked(m, x, y) {
            switch (m) {
                case 0: return (x + y) % 2 === 0;
                case 1: return y % 2 === 0;
                case 2: return x % 3 === 0;
                case 3: return (x + y) % 3 === 0;
                case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
                case 5: return x * y % 2 + x * y % 3 === 0;
                case 6: return (x * y % 2 + x * y % 3) % 2 === 0;
                default: return ((x + y) % 2 + x * y % 3) % 2 === 0;
            }
        }
        function applyMask(m) {
            for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) if (!fn[y][x] && masked(m, x, y)) mod[y][x] = !mod[y][x];
        }
        /* Penalty (rules 1, 2 and 4 of the standard; rule 3 left out: it only refines the choice) */
        function penalty() {
            var s = 0, dark = 0, x, y, run, last;
            for (y = 0; y < size; y++) {
                run = 0; last = null;
                for (x = 0; x < size; x++) {
                    if (mod[y][x]) dark++;
                    if (mod[y][x] === last) { run++; if (run === 5) s += 3; else if (run > 5) s++; } else { last = mod[y][x]; run = 1; }
                }
            }
            for (x = 0; x < size; x++) {
                run = 0; last = null;
                for (y = 0; y < size; y++) {
                    if (mod[y][x] === last) { run++; if (run === 5) s += 3; else if (run > 5) s++; } else { last = mod[y][x]; run = 1; }
                }
            }
            for (y = 0; y < size - 1; y++) for (x = 0; x < size - 1; x++) {
                var c = mod[y][x];
                if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) s += 3;
            }
            var total = size * size, k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
            return s + Math.max(0, k) * 10;
        }
        var best = 0, bestScore = Infinity;
        for (var m = 0; m < 8; m++) {
            applyMask(m); formatBits(m);
            var sc = penalty();
            if (sc < bestScore) { bestScore = sc; best = m; }
            applyMask(m);                                   // undo (XOR)
        }
        applyMask(best);
        var fb = formatBits(best);
        return { size: size, modules: mod, version: ver, mask: best, formatBits: fb };
    }

    function svg(text, px, level) {
        var q = encode(text, level), quiet = 4, n = q.size + quiet * 2, d = "";
        for (var y = 0; y < q.size; y++) for (var x = 0; x < q.size; x++) {
            if (q.modules[y][x]) d += "M" + (x + quiet) + " " + (y + quiet) + "h1v1h-1z";
        }
        return '<svg xmlns="http://www.w3.org/2000/svg" width="' + px + '" height="' + px + '" viewBox="0 0 ' + n + " " + n +
               '" shape-rendering="crispEdges"><rect width="' + n + '" height="' + n + '" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
    }

    global.APL = global.APL || {};
    global.APL.qr = encode;
    global.APL.qrSvg = svg;
    global.APL._qrTest = { remainder: remainder, divisor: divisor, mul: mul, dataCodewords: dataCodewords, ECC: ECC };
})(typeof window !== "undefined" ? window : this);
