// The handful of OpenCV operations the line OCR needs, on interleaved 8-bit pixels.

export type Raster = { data: Uint8Array; width: number; height: number; channels: 1 | 3 };
export type Point = [number, number];
/** Top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Point, Point, Point, Point];

/** RGBA from a canvas -> BGR (the order the detector was trained on) and cv2-weighted grey. */
export function splitRgba(rgba: Uint8ClampedArray, width: number, height: number): { bgr: Raster; gray: Raster } {
  const n = width * height;
  const bgr = new Uint8Array(n * 3);
  const gray = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
    bgr[i * 3] = b;
    bgr[i * 3 + 1] = g;
    bgr[i * 3 + 2] = r;
    gray[i] = (r * 4899 + g * 9617 + b * 1868 + 8192) >> 14;
  }
  return { bgr: { data: bgr, width, height, channels: 3 }, gray: { data: gray, width, height, channels: 1 } };
}

export function padWhite(img: Raster, pad: number): Raster {
  const width = img.width + 2 * pad, height = img.height + 2 * pad, c = img.channels;
  const data = new Uint8Array(width * height * c).fill(255);
  for (let y = 0; y < img.height; y++) {
    data.set(img.data.subarray(y * img.width * c, (y + 1) * img.width * c), ((y + pad) * width + pad) * c);
  }
  return { data, width, height, channels: c };
}

/** cv2.resize with INTER_LINEAR: half-pixel centres, edge taps clamped, no antialiasing. */
export function resizeLinear(img: Raster, width: number, height: number): Raster {
  const { width: w, height: h, channels: c, data: src } = img;
  const xs = taps(w, width), ys = taps(h, height);
  const data = new Uint8Array(width * height * c);
  for (let y = 0; y < height; y++) {
    const [y0, y1, fy] = ys[y];
    for (let x = 0; x < width; x++) {
      const [x0, x1, fx] = xs[x];
      for (let k = 0; k < c; k++) {
        const top = src[(y0 * w + x0) * c + k] * (1 - fx) + src[(y0 * w + x1) * c + k] * fx;
        const bot = src[(y1 * w + x0) * c + k] * (1 - fx) + src[(y1 * w + x1) * c + k] * fx;
        data[(y * width + x) * c + k] = Math.round(top * (1 - fy) + bot * fy);
      }
    }
  }
  return { data, width, height, channels: c };
}

function taps(from: number, to: number): [number, number, number][] {
  const scale = from / to;
  return Array.from({ length: to }, (_, i) => {
    const f = (i + 0.5) * scale - 0.5;
    let s = Math.floor(f), u = f - s;
    if (s < 0) [s, u] = [0, 0];
    if (s >= from - 1) [s, u] = [from - 1, 0];
    return [s, Math.min(s + 1, from - 1), u];
  });
}

/** Homography taking `from` to `to` (cv2.getPerspectiveTransform), as a row-major 3x3. */
function perspective(from: Quad, to: Quad): number[] {
  const a: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i], [u, v] = to[i];
    a.push([x, y, 1, 0, 0, 0, -x * u, -y * u, u]);
    a.push([0, 0, 0, x, y, 1, -x * v, -y * v, v]);
  }
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let r = col + 1; r < 8; r++) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    for (let r = 0; r < 8; r++) {
      if (r === col) continue;
      const f = a[r][col] / a[col][col];
      for (let k = col; k < 9; k++) a[r][k] -= f * a[col][k];
    }
  }
  return [...a.map((row, i) => row[8] / a[i][i]), 1];
}

function cubicWeights(t: number): [number, number, number, number] {
  const A = -0.75;
  const w0 = ((A * (t + 1) - 5 * A) * (t + 1) + 8 * A) * (t + 1) - 4 * A;
  const w1 = ((A + 2) * t - (A + 3)) * t * t + 1;
  const w2 = ((A + 2) * (1 - t) - (A + 3)) * (1 - t) * (1 - t) + 1;
  return [w0, w1, w2, 1 - w0 - w1 - w2];
}

/** One grey line cut out of the page along a quad (cv2.warpPerspective, INTER_CUBIC, BORDER_REPLICATE). */
export function warpQuad(gray: Raster, quad: Quad, width: number, height: number): Raster {
  // Map destination pixels back to the source: the transform from the target rectangle to the quad.
  const m = perspective([[0, 0], [width, 0], [width, height], [0, height]], quad);
  const { width: w, height: h, data: src } = gray;
  const at = (x: number, y: number) => src[Math.min(Math.max(y, 0), h - 1) * w + Math.min(Math.max(x, 0), w - 1)];
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d = m[6] * x + m[7] * y + m[8];
      const sx = (m[0] * x + m[1] * y + m[2]) / d, sy = (m[3] * x + m[4] * y + m[5]) / d;
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      const wx = cubicWeights(sx - x0), wy = cubicWeights(sy - y0);
      let v = 0;
      for (let j = 0; j < 4; j++) {
        let row = 0;
        for (let i = 0; i < 4; i++) row += wx[i] * at(x0 - 1 + i, y0 - 1 + j);
        v += wy[j] * row;
      }
      data[y * width + x] = Math.min(255, Math.max(0, Math.round(v)));
    }
  }
  return { data, width, height, channels: 1 };
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Dark text on white from any grey line crop: each column's background is the median of the crop's top and bottom
 * margin rows, smoothed along the line, and text is whatever differs from it, light or dark (_flatten in line_engine).
 */
export function flatten(g: Raster): Raster {
  const { width: w, height: h, data } = g;
  const k = Math.max(2, Math.floor(h / 6));
  const col: number[] = [];
  for (let x = 0; x < w; x++) {
    const margin: number[] = [];
    for (let y = 0; y < k; y++) margin.push(data[y * w + x], data[(h - 1 - y) * w + x]);
    col.push(Math.trunc(median(margin)));
  }
  const half = Math.max(3, Math.min(h | 1, 255)) >> 1;
  const bg = col.map((_, x) => {
    const win: number[] = [];
    for (let i = x - half; i <= x + half; i++) win.push(col[Math.min(Math.max(i, 0), w - 1)]);
    return median(win);
  });
  const diff = new Float32Array(w * h);
  const hist = new Array<number>(256).fill(0);
  for (let i = 0; i < w * h; i++) {
    diff[i] = Math.abs(data[i] - bg[i % w]);
    hist[Math.trunc(diff[i])] += 1;
  }
  let hi = 0;
  for (let acc = 0; hi < 256; hi++) if ((acc += hist[hi]) >= 0.98 * w * h) break;
  const scale = 255 / Math.max(hi, 24);
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = Math.trunc(255 - Math.min(255, diff[i] * scale));
  return { data: out, width: w, height: h, channels: 1 };
}
