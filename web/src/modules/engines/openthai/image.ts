// The OpenCV operations the line OCR needs, on interleaved 8-bit pixels, matching opencv-python 5.1 bit for bit:
// cv2.resize (INTER_LINEAR), cv2.warpPerspective and cv2.warpAffine (INTER_CUBIC), cv2.cvtColor (BGR2GRAY),
// np.rot90, and line_engine._flatten. image.test.ts checks them against OpenCV's own output (cv.fixtures.json).

export type Raster = { data: Uint8Array; width: number; height: number; channels: 1 | 3 };
export type Point = [number, number];
/** Top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Point, Point, Point, Point];
/** A 3x3 matrix, row-major. */
export type Mat3 = number[];

const f32 = Math.fround;
/** A float32 fused multiply-add: the product of two float32 values is exact in a double. */
const fma = (a: number, b: number, c: number) => f32(a * b + c);

/** Python's round() and OpenCV's cvRound: halves go to the even neighbour. */
export function roundHalfEven(v: number): number {
  const r = Math.round(v);
  return Math.abs(v % 1) === 0.5 && r % 2 ? r - 1 : r;
}

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** RGBA from a canvas -> BGR, the channel order cv2.imread gives and the detector was trained on. */
export function rgbaToBgr(rgba: Uint8ClampedArray, width: number, height: number): Raster {
  const n = width * height;
  const data = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    data[i * 3] = rgba[i * 4 + 2];
    data[i * 3 + 1] = rgba[i * 4 + 1];
    data[i * 3 + 2] = rgba[i * 4];
  }
  return { data, width, height, channels: 3 };
}

/** cv2.cvtColor(BGR2GRAY) in OpenCV 5: fixed-point weights, 15 bits. */
export function toGray(img: Raster): Raster {
  if (img.channels === 1) return img;
  const n = img.width * img.height, src = img.data;
  const data = new Uint8Array(n);
  for (let i = 0; i < n; i++) data[i] = (src[i * 3 + 2] * 9798 + src[i * 3 + 1] * 19235 + src[i * 3] * 3735 + 16384) >> 15;
  return { data, width: img.width, height: img.height, channels: 1 };
}

export function padWhite(img: Raster, pad: number): Raster {
  const width = img.width + 2 * pad, height = img.height + 2 * pad, c = img.channels;
  const data = new Uint8Array(width * height * c).fill(255);
  for (let y = 0; y < img.height; y++) {
    data.set(img.data.subarray(y * img.width * c, (y + 1) * img.width * c), ((y + pad) * width + pad) * c);
  }
  return { data, width, height, channels: c };
}

/** np.rot90(img, k): k = 1 is a quarter turn counter-clockwise, -1 clockwise, 2 a half turn. */
export function rot90(img: Raster, k: 1 | -1 | 2): Raster {
  const { width: w, height: h, channels: c, data } = img;
  const turned = k !== 2;
  const W = turned ? h : w, H = turned ? w : h;
  const out = new Uint8Array(w * h * c);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // Source pixel for output (x, y).
      const [sx, sy] = k === 1 ? [w - 1 - y, x] : k === -1 ? [y, h - 1 - x] : [w - 1 - x, h - 1 - y];
      for (let ch = 0; ch < c; ch++) out[(y * W + x) * c + ch] = data[(sy * w + sx) * c + ch];
    }
  }
  return { data: out, width: W, height: H, channels: c };
}

type Tap = { s: number; a0: number; a1: number };

/** Source pixel and 11-bit weights per destination column (resizeGeneric's xofs and ialpha). */
function linearTaps(from: number, to: number): Tap[] {
  const scale = 1 / (to / from);
  return Array.from({ length: to }, (_, d) => {
    let f = f32((d + 0.5) * scale - 0.5);
    let s = Math.floor(f);
    f = f32(f - s);
    if (s < 0) [s, f] = [0, 0];
    // Past the last pair the edge pixel is taken whole.
    if (s + 1 >= from) return { s: Math.min(s, from - 1), a0: 2048, a1: 0 };
    return { s, a0: roundHalfEven(f32(1 - f) * 2048), a1: roundHalfEven(f * 2048) };
  });
}

/**
 * cv2.resize with INTER_LINEAR on 8-bit pixels: 11-bit fixed-point weights, rows blended the way OpenCV's SIMD
 * kernel does it (each row's sum shifted right by 4, multiplied by its weight keeping the top 16 bits, then rounded).
 */
export function resizeLinear(img: Raster, width: number, height: number): Raster {
  const { width: w, height: h, channels: c, data: src } = img;
  if (w === width && h === height) return img;
  const xs = linearTaps(w, width);
  const scale = 1 / (height / h);
  const n = width * c;
  const rowCache = new Map<number, Int32Array>();
  const hrow = (y: number) => {
    let row = rowCache.get(y);
    if (row) return row;
    row = new Int32Array(n);
    const base = y * w * c;
    for (let x = 0; x < width; x++) {
      const { s, a0, a1 } = xs[x];
      const p = base + s * c;
      for (let k = 0; k < c; k++) row[x * c + k] = a1 ? src[p + k] * a0 + src[p + c + k] * a1 : src[p + k] * a0;
    }
    rowCache.set(y, row);
    if (rowCache.size > 4) rowCache.delete(rowCache.keys().next().value!);
    return row;
  };
  const data = new Uint8Array(n * height);
  for (let y = 0; y < height; y++) {
    let f = f32((y + 0.5) * scale - 0.5);
    const s = Math.floor(f);
    f = f32(f - s);
    const b0 = roundHalfEven(f32(1 - f) * 2048), b1 = roundHalfEven(f * 2048);
    const S0 = hrow(Math.min(Math.max(s, 0), h - 1)), S1 = hrow(Math.min(Math.max(s + 1, 0), h - 1));
    for (let x = 0; x < n; x++) {
      const v = ((((S0[x] >> 4) * b0) >> 16) + (((S1[x] >> 4) * b1) >> 16) + 2) >> 2;
      data[y * n + x] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
  }
  return { data, width, height, channels: c };
}

/** OpenCV's bicubic weights for a fractional offset (bicubicWeights in warp_kernels, A = -0.75, float32). */
function cubicWeights(t: number, out: Float64Array, at: number) {
  const a2 = f32(t * t), b = f32(1 - t), b2 = f32(b * b);
  const w0 = f32(-0.75 * f32(t * b2)), w3 = f32(-0.75 * f32(a2 * b));
  const w1 = fma(a2, fma(1.25, t, -2.25), 1);
  out[at] = w0;
  out[at + 1] = w1;
  out[at + 2] = f32(f32(f32(1 - w0) - w1) - w3);
  out[at + 3] = w3;
}

/**
 * OpenCV 5's cubic warp (genericWarp + bicubicVec): `coords` fills the float32 source position of every pixel in a
 * row; pixels outside the image repeat the edge, or take `fill` when it is given.
 */
function warpCubic(
  img: Raster, width: number, height: number, fill: number[] | null,
  coords: (y: number, xs: Float64Array, ys: Float64Array) => void,
): Raster {
  const { width: w, height: h, channels: c, data: src } = img;
  const out = new Uint8Array(width * height * c);
  const xs = new Float64Array(width), ys = new Float64Array(width);
  const wx = new Float64Array(4), wy = new Float64Array(4);
  const bw = Math.max(w, 16), bh = Math.max(h, 16);
  const col = new Int32Array(4);
  for (let y = 0; y < height; y++) {
    coords(y, xs, ys);
    for (let x = 0; x < width; x++) {
      const vx = Math.min(Math.max(xs[x], -bw), 2 * bw), vy = Math.min(Math.max(ys[x], -bh), 2 * bh);
      const ix = Math.floor(vx), iy = Math.floor(vy);
      const o = (y * width + x) * c;
      if (fill && (ix + 3 < 0 || iy + 3 < 0 || ix - 1 >= w || iy - 1 >= h)) {
        for (let k = 0; k < c; k++) out[o + k] = fill[k];
        continue;
      }
      cubicWeights(f32(vx - ix), wx, 0);
      cubicWeights(f32(vy - iy), wy, 0);
      const inside = ix >= 1 && iy >= 1 && ix + 2 < w && iy + 2 < h;
      for (let j = 0; j < 4; j++) col[j] = Math.min(Math.max(ix - 1 + j, 0), w - 1);
      for (let k = 0; k < c; k++) {
        let acc = 0;
        for (let r = 0; r < 4; r++) {
          const yy = iy - 1 + r;
          let p0: number, p1: number, p2: number, p3: number;
          if (inside) {
            const base = (yy * w + ix - 1) * c + k;
            p0 = src[base]; p1 = src[base + c]; p2 = src[base + 2 * c]; p3 = src[base + 3 * c];
          } else if (fill) {
            const rowOk = yy >= 0 && yy < h;
            const at = (j: number) => {
              const xx = ix - 1 + j;
              return rowOk && xx >= 0 && xx < w ? src[(yy * w + xx) * c + k] : fill[k];
            };
            p0 = at(0); p1 = at(1); p2 = at(2); p3 = at(3);
          } else {
            const base = Math.min(Math.max(yy, 0), h - 1) * w;
            p0 = src[(base + col[0]) * c + k]; p1 = src[(base + col[1]) * c + k];
            p2 = src[(base + col[2]) * c + k]; p3 = src[(base + col[3]) * c + k];
          }
          let s = f32(p0 * wx[0]);
          s = fma(p1, wx[1], s);
          s = fma(p2, wx[2], s);
          s = fma(p3, wx[3], s);
          acc = fma(s, wy[r], acc);
        }
        const v = roundHalfEven(acc);
        out[o + k] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
  }
  return { data: out, width, height, channels: c };
}

/**
 * cv2.getPerspectiveTransform(src, dst): the 8x8 system OpenCV builds (its src.x * dst.x products are float32) solved
 * with OpenCV's LU decomposition.
 */
export function perspectiveTransform(src: Quad, dst: Quad): Mat3 {
  const a = Array.from({ length: 8 }, () => new Array<number>(8).fill(0));
  const b = new Array<number>(8).fill(0);
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    a[i][0] = a[i + 4][3] = x;
    a[i][1] = a[i + 4][4] = y;
    a[i][2] = a[i + 4][5] = 1;
    a[i][6] = f32(-x * u);
    a[i][7] = f32(-y * u);
    a[i + 4][6] = f32(-x * v);
    a[i + 4][7] = f32(-y * v);
    b[i] = u;
    b[i + 4] = v;
  }
  for (let i = 0; i < 8; i++) {
    let k = i;
    for (let j = i + 1; j < 8; j++) if (Math.abs(a[j][i]) > Math.abs(a[k][i])) k = j;
    if (k !== i) {
      [a[i], a[k]] = [a[k], a[i]];
      [b[i], b[k]] = [b[k], b[i]];
    }
    const d = -1 / a[i][i];
    for (let j = i + 1; j < 8; j++) {
      const alpha = a[j][i] * d;
      for (let m = i + 1; m < 8; m++) a[j][m] += alpha * a[i][m];
      b[j] += alpha * b[i];
    }
  }
  for (let i = 7; i >= 0; i--) {
    let s = b[i];
    for (let k = i + 1; k < 8; k++) s -= a[i][k] * b[k];
    b[i] = s / a[i][i];
  }
  return [...b, 1];
}

/** cv2.invert for a 3x3 matrix: cofactors over the determinant. */
export function invert3(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  let det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  det = det !== 0 ? 1 / det : 0;
  return [
    (e * i - f * h) * det, (c * h - b * i) * det, (b * f - c * e) * det,
    (f * g - d * i) * det, (a * i - c * g) * det, (c * d - a * f) * det,
    (d * h - e * g) * det, (b * g - a * h) * det, (a * e - b * d) * det,
  ];
}

export function multiply3(p: Mat3, q: Mat3): Mat3 {
  return Array.from({ length: 9 }, (_, n) => {
    const r = (n / 3) | 0, c = n % 3;
    return p[r * 3] * q[c] + p[r * 3 + 1] * q[3 + c] + p[r * 3 + 2] * q[6 + c];
  });
}

/** Points through a 3x3 matrix (line_engine._apply). */
export function applyMat(m: Mat3, pts: number[][]): Point[] {
  return pts.map(([x, y]) => [m[0] * x + m[1] * y + m[2], m[3] * x + m[4] * y + m[5]]);
}

/** cv2.warpPerspective(img, getPerspectiveTransform(quad, rect), (width, height), INTER_CUBIC, BORDER_REPLICATE). */
export function warpQuad(img: Raster, quad: Quad, width: number, height: number): Raster {
  const rect: Quad = [[0, 0], [width, 0], [width, height], [0, height]];
  const m = invert3(perspectiveTransform(quad, rect)).map(f32);
  return warpCubic(img, width, height, null, (y, xs, ys) => {
    const mx = f32(f32(y * m[1]) + m[2]), my = f32(f32(y * m[4]) + m[5]), mz = f32(f32(y * m[7]) + m[8]);
    for (let x = 0; x < width; x++) {
      const invz = 1 / (mz + m[6] * x);
      xs[x] = f32((mx + m[0] * x) * invz);
      ys[x] = f32((my + m[3] * x) * invz);
    }
  });
}

/** cv2.warpAffine(img, m, (width, height), INTER_CUBIC, BORDER_CONSTANT, fill); m is the forward 2x3 map. */
export function warpAffine(img: Raster, m: number[], width: number, height: number, fill: number[]): Raster {
  let det = m[0] * m[4] - m[1] * m[3];
  det = det !== 0 ? 1 / det : 0;
  const i0 = m[4] * det, i1 = -m[1] * det, i3 = -m[3] * det, i4 = m[0] * det;
  const inv = [i0, i1, -i0 * m[2] - i1 * m[5], i3, i4, -i3 * m[2] - i4 * m[5]].map(f32);
  return warpCubic(img, width, height, fill, (y, xs, ys) => {
    const mx = f32(f32(y * inv[1]) + inv[2]), my = f32(f32(y * inv[4]) + inv[5]);
    for (let x = 0; x < width; x++) {
      xs[x] = f32(mx + f32(inv[0] * x));
      ys[x] = f32(my + f32(inv[3] * x));
    }
  });
}

/** Per-channel median of the image's outermost rows and columns, truncated (the fill _deskew uses). */
export function borderMedian(img: Raster): number[] {
  const { width: w, height: h, channels: c, data } = img;
  return Array.from({ length: c }, (_, k) => {
    const v: number[] = [];
    for (let x = 0; x < w; x++) v.push(data[x * c + k], data[((h - 1) * w + x) * c + k]);
    for (let y = 0; y < h; y++) v.push(data[y * w * c + k], data[(y * w + w - 1) * c + k]);
    return Math.trunc(median(v));
  });
}

/**
 * Dark text on white from a grey line crop: each column's background is the median of the crop's top and bottom
 * margin rows, smoothed along the line, and text is whatever differs from it, light or dark (_flatten).
 */
export function flatten(g: Raster): Raster {
  const { width: w, height: h, data } = g;
  const k = Math.min(Math.max(2, Math.floor(h / 6)), h);
  const col: number[] = [];
  const margin: number[] = [];
  for (let x = 0; x < w; x++) {
    margin.length = 0;
    for (let y = 0; y < k; y++) margin.push(data[y * w + x], data[(h - k + y) * w + x]);
    col.push(Math.trunc(median(margin)));
  }
  const half = Math.max(3, Math.min(h | 1, 255)) >> 1;
  // A sliding histogram: the median of each window of 2 * half + 1 columns, edges repeated.
  const hist = new Int32Array(256);
  const at = (i: number) => col[Math.min(Math.max(i, 0), w - 1)];
  for (let i = -half; i <= half; i++) hist[at(i)] += 1;
  const bg = new Float32Array(w);
  const mid = half + 1;
  for (let x = 0; x < w; x++) {
    let acc = 0, v = 0;
    while ((acc += hist[v]) < mid) v += 1;
    bg[x] = v;
    hist[at(x - half)] -= 1;
    hist[at(x + half + 1)] += 1;
  }
  const n = w * h;
  const diff = new Float32Array(n);
  const counts = new Int32Array(256);
  for (let i = 0; i < n; i++) {
    diff[i] = Math.abs(data[i] - bg[i % w]);
    counts[diff[i]] += 1;
  }
  let hi = 0;
  for (let acc = 0; hi < 256; hi++) if ((acc += counts[hi]) >= 0.98 * n) break;
  const scale = f32(255 / Math.max(hi, 24));
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.trunc(f32(255 - Math.min(255, f32(diff[i] * scale))));
  return { data: out, width: w, height: h, channels: 1 };
}
