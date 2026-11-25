// How close a model's text is to the correct text: accuracy and the word-level mistakes.
export { cer, normalize } from "./core/cer";
export { type Diff, type Segment, diffWords, toPlainText } from "./core/diff";
