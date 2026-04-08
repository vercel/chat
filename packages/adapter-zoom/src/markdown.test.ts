import { describe, it } from "vitest";

describe("ZoomFormatConverter.toAst() — FMT-01", () => {
  it.todo("converts **bold** to strong node");
  it.todo("converts _italic_ to emphasis node");
  it.todo("converts `code` to inlineCode node");
  it.todo("converts ~strikethrough~ (single tilde) to delete node");
  it.todo("converts __underline__ to custom underline node");
  it.todo("converts # heading to heading depth-1 node");
  it.todo("converts * list item to list + listItem nodes");
});

describe("ZoomFormatConverter.fromAst() — FMT-02", () => {
  it.todo("converts strong node to **bold**");
  it.todo("converts emphasis node to _italic_");
  it.todo("converts inlineCode node to `code`");
  it.todo("converts delete node to ~strikethrough~ (single tilde)");
  it.todo("converts custom underline node to __underline__");
  it.todo("converts heading node to # heading");
  it.todo("converts list+listItem nodes to * list item");
});

describe("ZoomFormatConverter round-trips — FMT-03", () => {
  it.todo("__underline__ round-trips: toAst then fromAst produces __underline__");
  it.todo("~strikethrough~ round-trips: toAst then fromAst produces ~strikethrough~");
  it.todo("combined formatting: __underline__ and ~strikethrough~ in same string");
});
