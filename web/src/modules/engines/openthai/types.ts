// Shapes shared by the page steps of the browser port of LineOCR.

export type ModelName = "det" | "rec" | "rec2";

/** Runs one network on a float32 NCHW tensor and returns its first output. */
export type RunModel = (
  model: ModelName,
  input: Float32Array,
  dims: number[],
) => Promise<{ data: Float32Array; dims: readonly number[] }>;

/** What readPage needs besides the image: the networks, and the CTC classes (rec_dict.txt between blank and space). */
export type Models = { run: RunModel; chars: string[]; rec2: boolean };

/** One recognised character: x0..x1 is the share of the crop's width its CTC frames cover, p its probability. */
export type Char = { ch: string; x0: number; x1: number; p: number };

/** One line's reading. `chars` is null when the line was read turned, so positions along it don't apply. */
export type Reading = { text: string; conf: number; chars: Char[] | null };
