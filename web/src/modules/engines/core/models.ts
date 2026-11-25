// The names people see. Engine ids stay in the API; nobody outside the dev team should have to read them.

export type ModelInfo = {
  name: string;
  goodFor: string;
  badge: string | null;
  /** Reads the page inside the browser, so the file never leaves the device. */
  private: boolean;
};

const MODELS: Record<string, ModelInfo> = {
  "openthai-text-browser": {
    name: "OpenThai Quick · Private",
    goodFor: "Runs in your browser. The file stays on your computer.",
    badge: "Private",
    private: true,
  },
  "openthai-text": {
    name: "OpenThai Quick",
    goodFor: "Plain text, read on our server.",
    badge: null,
    private: false,
  },
  "openthai-markdown": {
    name: "OpenThai Layout",
    goodFor: "Keeps tables and headings.",
    badge: "Keeps tables",
    private: false,
  },
  typhoon: {
    name: "Typhoon",
    goodFor: "Keeps tables and headings. Slower.",
    badge: "Keeps tables",
    private: false,
  },
};

export function modelInfo(engine: string): ModelInfo {
  return MODELS[engine] ?? { name: engine, goodFor: "", badge: null, private: false };
}

/** A failure in words a non-developer can act on. The raw message stays available as technical detail. */
export function explainError(engine: string, raw: string): string {
  const { name } = modelInfo(engine);
  if (/time(d)?\s*out|timeout|\b50[234]\b/i.test(raw)) {
    return `${name} is starting up or busy. The first try of the day can take up to a minute. Try again.`;
  }
  if (/failed to fetch|networkerror|load failed|econnrefused/i.test(raw)) {
    return `We can't reach the server that runs ${name}. Try again in a moment.`;
  }
  if (/worker failed/i.test(raw)) {
    return `${name} couldn't start in this browser. Reload the page and try again.`;
  }
  return `${name} couldn't read this page. Try again, or try another model.`;
}
