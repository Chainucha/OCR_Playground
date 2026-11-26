// LineOCR's effective settings for OpenThai2.1-OCR-Text at commit c765cb8: runtime/line_engine.py DEFAULTS, then
// det.yml's PostProcess (thresh, box_thresh, unclip_ratio), then config.json, as LineOCR.__init__ merges them.
// Print the Python side's copy with:
//   cd engines && python -m uv run python -c "from ocr_playground.engines.openthai_text import DEFAULT_DIR,
//   load_runtime; print(load_runtime(DEFAULT_DIR).LineOCR(str(DEFAULT_DIR)).cfg)"
// Names follow the Python keys in camelCase. Not ported: rec.color (always "flatten" here), runtime (backend).

export const CFG = {
  det: {
    limit: 1280, // DEFAULTS
    thresh: 0.2, // det.yml (DEFAULTS 0.3)
    boxThresh: 0.4, // det.yml (DEFAULTS 0.6)
    unclip: 1.4, // det.yml unclip_ratio (DEFAULTS 1.5)
    minSize: 3, // DEFAULTS
    maxCandidates: 3000, // DEFAULTS
    vPad: 0, // DEFAULTS: off
    shortPad: 0, // DEFAULTS: off
    rescanBelow: 0, // DEFAULTS: off
    rescanTarget: 20, // DEFAULTS
    rescanMax: 3200, // DEFAULTS
    splitGap: 1.2, // DEFAULTS
  },
  rec: {
    height: 48, // DEFAULTS
    maxW: 3200, // DEFAULTS
    batch: 16, // DEFAULTS
    dropBelow: 0.8, // config.json (DEFAULTS 0)
    minChars: 2, // config.json (DEFAULTS 1)
    minCharsDigits: 1 as number | null, // config.json (DEFAULTS None)
    minCharsDigitsHeight: 0.62, // config.json (DEFAULTS 0)
    minCharsLatin: true, // config.json (DEFAULTS false)
    junkBelow: 0.9, // config.json (DEFAULTS 0)
    junkInvalid: 0.05, // config.json (DEFAULTS 1)
  },
  ori: {
    enabled: true, // DEFAULTS
    sample: 8, // DEFAULTS
    flipBelow: 0.8, // DEFAULTS
    flipMargin: 0.15, // DEFAULTS
    deskewAbove: 2.5, // DEFAULTS
  },
  marks: {
    enabled: true, // DEFAULTS
    maxGap: 0.35, // DEFAULTS
    maxExt: 0.9, // DEFAULTS
    maxHeight: 0.9, // DEFAULTS
    margin: 0, // DEFAULTS
    pageShare: 0.25, // DEFAULTS
    pageMin: 3, // DEFAULTS
    keepBase: true, // DEFAULTS
  },
  cols: {
    listRep: 0.6, // DEFAULTS
    listFacing: 0, // DEFAULTS: off
    listMaxW: 10, // DEFAULTS
    listEnum: 0, // DEFAULTS: off
  },
  rec2: {
    minMixed: 1, // DEFAULTS; config.json turns rec2 on with file rec2.onnx (readPage's `rec2` argument)
  },
  join: {
    thaiNoSpace: false, // DEFAULTS
    decimalComma: true, // config.json (DEFAULTS false)
    paragraphs: false, // DEFAULTS
    paragraphGap: 1, // DEFAULTS
  },
};

export type Config = typeof CFG;
export type ColumnRules = Config["cols"];
