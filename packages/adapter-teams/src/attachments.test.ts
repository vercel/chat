import { describe, expect, it, vi } from "vitest";
import {
  createAnonymousAttachmentFetchData,
  createTeamsAttachment,
  createTeamsGraphAttachment,
  rehydrateTeamsAttachment,
  type TeamsAttachmentFetchers,
  toTeamsOutboundAttachments,
} from "./attachments";

const DATA_URI_PATTERN = /^data:([^;]+);base64,(.*)$/;
const ONE_MEGABYTE = 1024 * 1024;

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52,
]);
const JPEG_BYTES = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00,
]);
const GIF_BYTES = Buffer.from("GIF89a\u0001\u0000\u0001\u0000", "latin1");
const UNKNOWN_BYTES = Buffer.from("not a known image format");

function decodeDataUri(uri: string): { bytes: Buffer; mimeType: string } {
  const match = DATA_URI_PATTERN.exec(uri);
  if (!match) {
    throw new Error(`Not a base64 data URI: ${uri.slice(0, 40)}`);
  }
  return { mimeType: match[1], bytes: Buffer.from(match[2], "base64") };
}

const CONNECTOR_URL = "https://smba.trafficmanager.net/teams/";

function createFetchers(
  fetchAuthenticated: TeamsAttachmentFetchers["fetchAuthenticated"],
  transfer?: (url: string) => Promise<Buffer>,
  fetchGraphFile: TeamsAttachmentFetchers["fetchGraphFile"] = vi.fn()
): TeamsAttachmentFetchers {
  return {
    createAnonymousFetchData: transfer
      ? (url) => () => transfer(url)
      : createAnonymousAttachmentFetchData,
    fetchAuthenticated,
    fetchGraphFile,
  };
}

describe("Teams attachments", () => {
  it("downloads Graph file references through Graph and survives rehydration", async () => {
    const fetchAuthenticated = vi.fn();
    const transfer = vi.fn();
    const fetchGraphFile = vi.fn(async () => Buffer.from("pdf bytes"));
    const fetchers = createFetchers(
      fetchAuthenticated,
      transfer,
      fetchGraphFile
    );
    const url =
      "https://contoso-my.sharepoint.com/personal/user/Documents/Microsoft Teams Chat Files/report.pdf";

    const attachment = createTeamsGraphAttachment(
      { contentType: "reference", contentUrl: url, name: "report.pdf" },
      fetchers
    );

    expect(attachment).toMatchObject({
      type: "file",
      url,
      name: "report.pdf",
      mimeType: "application/pdf",
      fetchMetadata: { url, auth: "graph" },
    });
    await expect(attachment.fetchData?.()).resolves.toEqual(
      Buffer.from("pdf bytes")
    );

    const { fetchData: _fetchData, ...serialized } = attachment;
    const rehydrated = rehydrateTeamsAttachment(
      JSON.parse(JSON.stringify(serialized)) as typeof serialized,
      fetchers
    );
    await expect(rehydrated.fetchData?.()).resolves.toEqual(
      Buffer.from("pdf bytes")
    );

    expect(fetchGraphFile).toHaveBeenCalledTimes(2);
    expect(fetchGraphFile).toHaveBeenCalledWith(url);
    expect(transfer).not.toHaveBeenCalled();
    expect(fetchAuthenticated).not.toHaveBeenCalled();
  });

  it("keeps non-file Graph attachments as metadata only", () => {
    const attachment = createTeamsGraphAttachment(
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        name: null,
      },
      createFetchers(vi.fn())
    );

    expect(attachment).toEqual({
      type: "file",
      name: undefined,
      url: undefined,
      mimeType: "application/vnd.microsoft.card.adaptive",
    });
  });

  it("downloads file cards anonymously and infers their MIME type", async () => {
    const fetchAuthenticated = vi.fn();
    const transfer = vi.fn(async () => Buffer.from("file contents"));
    const url = "https://contoso-my.sharepoint.com/personal/user/file.png";

    const attachment = createTeamsAttachment(
      {
        contentType: "application/vnd.microsoft.teams.file.download.info",
        content: {
          downloadUrl: url,
          fileType: ".png",
        },
        name: "diagram.png",
      },
      CONNECTOR_URL,
      createFetchers(fetchAuthenticated, transfer)
    );

    expect(attachment).toMatchObject({
      type: "image",
      url,
      name: "diagram.png",
      mimeType: "image/png",
      fetchMetadata: { url },
    });
    await expect(attachment.fetchData?.()).resolves.toEqual(
      Buffer.from("file contents")
    );
    expect(transfer).toHaveBeenCalledWith(url);
    expect(fetchAuthenticated).not.toHaveBeenCalled();
  });

  it.each([
    [".pdf", "application/pdf"],
    [".xls", "application/vnd.ms-excel"],
    [
      ".xlsx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ],
  ])("infers the MIME type for %s file cards", (fileType, mimeType) => {
    const attachment = createTeamsAttachment(
      {
        contentType: "application/vnd.microsoft.teams.file.download.info",
        content: {
          downloadUrl: "https://files.example.com/download",
          fileType,
        },
        name: `report${fileType}`,
      },
      CONNECTOR_URL,
      createFetchers(vi.fn())
    );

    expect(attachment).toMatchObject({
      type: "file",
      mimeType,
    });
  });

  it("keeps cross-origin inline attachments anonymous", async () => {
    const fetchAuthenticated = vi.fn();
    const transfer = vi.fn(async () => Buffer.from("public image"));
    const url = "https://files.example.com/image.png";

    const attachment = createTeamsAttachment(
      {
        contentType: "image/png",
        contentUrl: url,
        name: "image.png",
      },
      CONNECTOR_URL,
      createFetchers(fetchAuthenticated, transfer)
    );

    expect(attachment).toMatchObject({
      type: "image",
      url,
      name: "image.png",
      mimeType: "image/png",
      fetchMetadata: { url },
    });
    await expect(attachment.fetchData?.()).resolves.toEqual(
      Buffer.from("public image")
    );
    expect(transfer).toHaveBeenCalledWith(url);
    expect(fetchAuthenticated).not.toHaveBeenCalled();
  });

  it("rejects plain-HTTP inline attachment downloads by default", async () => {
    const fetchAuthenticated = vi.fn();
    const url = "http://contoso-my.sharepoint.com/image.png";

    const attachment = createTeamsAttachment(
      {
        contentType: "image/png",
        contentUrl: url,
        name: "image.png",
      },
      CONNECTOR_URL,
      createFetchers(fetchAuthenticated)
    );

    await expect(attachment.fetchData?.()).rejects.toThrow(
      "Refusing to fetch an untrusted attachment URL"
    );
    expect(fetchAuthenticated).not.toHaveBeenCalled();
  });

  it("authenticates emulator attachments on a loopback HTTP connector", async () => {
    const fetchAuthenticated = vi.fn(async () => Buffer.from("emulator image"));
    const url = "http://localhost:3978/v3/attachments/image/views/original";

    const attachment = createTeamsAttachment(
      {
        contentType: "image/png",
        contentUrl: url,
        name: "image.png",
      },
      "http://localhost:3978/",
      createFetchers(fetchAuthenticated)
    );

    expect(attachment.fetchMetadata).toEqual({
      url,
      auth: "bot",
      connectorOrigin: "http://localhost:3978",
    });
    await expect(attachment.fetchData?.()).resolves.toEqual(
      Buffer.from("emulator image")
    );
    expect(fetchAuthenticated).toHaveBeenCalledWith(url);
  });

  it("rehydrates both retrieval modes and revalidates bot destinations", async () => {
    const fetchAuthenticated = vi.fn(async () =>
      Buffer.from("rehydrated image")
    );
    const transfer = vi.fn(async () => Buffer.from("anonymous file"));
    const fetchers = createFetchers(fetchAuthenticated, transfer);
    const url =
      "https://smba.trafficmanager.net/teams/v3/attachments/image/views/original";
    const serialized = JSON.parse(
      JSON.stringify({
        type: "image",
        url,
        fetchMetadata: {
          url,
          auth: "bot",
          connectorOrigin: "https://smba.trafficmanager.net",
        },
      })
    ) as Parameters<typeof rehydrateTeamsAttachment>[0];

    const rehydrated = rehydrateTeamsAttachment(serialized, fetchers);
    await expect(rehydrated.fetchData?.()).resolves.toEqual(
      Buffer.from("rehydrated image")
    );

    for (const untrusted of [
      {
        url: "https://files.example.com/image.png",
        connectorOrigin: "https://smba.trafficmanager.net",
      },
      {
        url: "http://smba.trafficmanager.net/teams/image.png",
        connectorOrigin: "https://smba.trafficmanager.net",
      },
      {
        url,
        connectorOrigin: undefined,
      },
    ]) {
      const attachment = rehydrateTeamsAttachment(
        {
          type: "image",
          url: untrusted.url,
          fetchMetadata: {
            url: untrusted.url,
            auth: "bot",
            ...(untrusted.connectorOrigin
              ? { connectorOrigin: untrusted.connectorOrigin }
              : {}),
          },
        },
        fetchers
      );
      await expect(attachment.fetchData?.()).rejects.toThrow(
        "Refusing to send a bot token to an untrusted attachment URL"
      );
    }

    const anonymousUrl = "https://files.example.com/report.pdf";
    const anonymous = rehydrateTeamsAttachment(
      JSON.parse(
        JSON.stringify({
          type: "file",
          url: anonymousUrl,
          mimeType: "application/pdf",
          fetchMetadata: { url: anonymousUrl },
        })
      ) as Parameters<typeof rehydrateTeamsAttachment>[0],
      fetchers
    );
    await expect(anonymous.fetchData?.()).resolves.toEqual(
      Buffer.from("anonymous file")
    );

    expect(fetchAuthenticated).toHaveBeenCalledTimes(1);
    expect(transfer).toHaveBeenCalledWith(anonymousUrl);
  });

  it.each([
    "http://169.254.169.254/latest/meta-data",
    "https://127.0.0.1/private",
    "https://2130706433/private",
    "https://[::1]/private",
  ])("rejects internal anonymous URL %s after rehydration", async (url) => {
    const attachment = rehydrateTeamsAttachment(
      {
        type: "file",
        url,
        fetchMetadata: { url },
      },
      createFetchers(vi.fn())
    );

    await expect(attachment.fetchData?.()).rejects.toThrow(
      "Refusing to fetch an internal attachment URL"
    );
  });
});

describe("toTeamsOutboundAttachments", () => {
  describe("attachments sent by URL", () => {
    it("sends an HTTPS image by reference with the caller's URL and MIME type", async () => {
      const result = await toTeamsOutboundAttachments(
        [
          {
            type: "image",
            url: "https://example.com/screenshot.png?sig=abc",
            mimeType: "image/gif",
            name: "screenshot.png",
          },
        ],
        "send"
      );

      expect(result).toEqual({
        attachments: [
          {
            contentType: "image/gif",
            contentUrl: "https://example.com/screenshot.png?sig=abc",
            name: "screenshot.png",
          },
        ],
        skipped: [],
      });
    });

    it("accepts an uppercase scheme and sends the URL unchanged", async () => {
      const result = await toTeamsOutboundAttachments(
        [{ type: "image", url: "HTTPS://Example.com/a.png" }],
        "send"
      );

      expect(result).toEqual({
        attachments: [
          {
            contentType: "image/png",
            contentUrl: "HTTPS://Example.com/a.png",
            name: undefined,
          },
        ],
        skipped: [],
      });
    });

    it.each([
      ["an http URL", "http://example.com/a.png", "not-https"],
      ["a data URL", "data:image/png;base64,iVBORw0KGgo=", "not-https"],
      ["a malformed URL", "example.com/a.png", "invalid-url"],
      ["a bare https://", "https://", "invalid-url"],
      ["an empty URL", "", "no-content"],
      ["no URL", undefined, "no-content"],
    ])("skips %s", async (_label, url, reason) => {
      const result = await toTeamsOutboundAttachments(
        [{ type: "image", url, name: "a.png", mimeType: "image/png" }],
        "send"
      );

      expect(result).toEqual({
        attachments: [],
        skipped: [{ index: 0, name: "a.png", reason }],
      });
    });
  });

  describe("image-only filter", () => {
    it.each([
      ["a pdf file", { type: "file", mimeType: "application/pdf" }],
      ["a file with no MIME type", { type: "file" }],
      ["a video", { type: "video", mimeType: "video/mp4" }],
      ["a video with no MIME type", { type: "video" }],
      ["an audio clip", { type: "audio", mimeType: "audio/mpeg" }],
      [
        "an image type with a pdf MIME type",
        { type: "image", mimeType: "application/pdf" },
      ],
      [
        "a MIME type with image/ after its start",
        { type: "image", mimeType: "application/x-image/png" },
      ],
    ] as const)("skips %s whether it has a URL or bytes", async (_label, kind) => {
      const fetchData = vi.fn(async () => PNG_BYTES);

      const result = await toTeamsOutboundAttachments(
        [
          { ...kind, url: "https://example.com/doc", name: "by-url" },
          { ...kind, data: PNG_BYTES, name: "by-data" },
          { ...kind, fetchData, name: "by-fetch" },
        ],
        "send"
      );

      expect(result).toEqual({
        attachments: [],
        skipped: [
          { index: 0, name: "by-url", reason: "unsupported-type" },
          { index: 1, name: "by-data", reason: "unsupported-type" },
          { index: 2, name: "by-fetch", reason: "unsupported-type" },
        ],
      });
      expect(fetchData).not.toHaveBeenCalled();
    });

    it("keeps a file-typed attachment whose MIME type is an image, in any case", async () => {
      const result = await toTeamsOutboundAttachments(
        [
          {
            type: "file",
            url: "https://example.com/a",
            mimeType: "IMAGE/PNG",
          },
        ],
        "send"
      );

      expect(result).toEqual({
        attachments: [
          {
            contentType: "IMAGE/PNG",
            contentUrl: "https://example.com/a",
            name: undefined,
          },
        ],
        skipped: [],
      });
    });
  });

  describe("an empty MIME type", () => {
    it("is treated as no MIME type, so the attachment type and the name decide", async () => {
      const result = await toTeamsOutboundAttachments(
        [
          {
            type: "image",
            mimeType: "",
            url: "https://example.com/a",
            name: "a.gif",
          },
          { type: "image", mimeType: "", data: JPEG_BYTES, name: "b" },
          {
            type: "file",
            mimeType: "",
            url: "https://example.com/c.png",
            name: "c.png",
          },
        ],
        "send"
      );

      expect(result).toEqual({
        attachments: [
          {
            contentType: "image/gif",
            contentUrl: "https://example.com/a",
            name: "a.gif",
          },
          {
            contentType: "image/jpeg",
            contentUrl: `data:image/jpeg;base64,${JPEG_BYTES.toString("base64")}`,
            name: "b",
          },
        ],
        skipped: [{ index: 2, name: "c.png", reason: "unsupported-type" }],
      });
    });
  });

  describe("attachments with bytes", () => {
    it("inlines `data` and ignores the URL next to it", async () => {
      const result = await toTeamsOutboundAttachments(
        [
          {
            type: "image",
            data: PNG_BYTES,
            url: "https://private.example.com/needs-auth.png",
            mimeType: "image/png",
            name: "shot.png",
          },
        ],
        "send"
      );

      expect(result.skipped).toEqual([]);
      expect(result.attachments).toEqual([
        {
          contentType: "image/png",
          contentUrl: `data:image/png;base64,${PNG_BYTES.toString("base64")}`,
          name: "shot.png",
        },
      ]);
      expect(
        decodeDataUri(result.attachments[0].contentUrl).bytes.equals(PNG_BYTES)
      ).toBe(true);
    });

    it("inlines what `fetchData` returns and ignores the URL next to it", async () => {
      const fetchData = vi.fn(
        async () =>
          JPEG_BYTES.buffer.slice(
            JPEG_BYTES.byteOffset,
            JPEG_BYTES.byteOffset + JPEG_BYTES.byteLength
          ) as ArrayBuffer
      );

      const result = await toTeamsOutboundAttachments(
        [
          {
            type: "image",
            fetchData,
            url: "https://private.example.com/needs-auth.jpg",
            mimeType: "image/jpeg",
          },
        ],
        "send"
      );

      expect(fetchData).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        attachments: [
          {
            contentType: "image/jpeg",
            contentUrl: `data:image/jpeg;base64,${JPEG_BYTES.toString("base64")}`,
            name: undefined,
          },
        ],
        skipped: [],
      });
      expect(
        decodeDataUri(result.attachments[0].contentUrl).bytes.equals(JPEG_BYTES)
      ).toBe(true);
    });

    it("inlines Blob data", async () => {
      const result = await toTeamsOutboundAttachments(
        [{ type: "image", data: new Blob([GIF_BYTES]), mimeType: "image/gif" }],
        "send"
      );

      expect(result).toEqual({
        attachments: [
          {
            contentType: "image/gif",
            contentUrl: `data:image/gif;base64,${GIF_BYTES.toString("base64")}`,
            name: undefined,
          },
        ],
        skipped: [],
      });
      expect(
        decodeDataUri(result.attachments[0].contentUrl).bytes.equals(GIF_BYTES)
      ).toBe(true);
    });

    it("uses `data` without calling `fetchData` when both are set", async () => {
      const fetchData = vi.fn(async () => JPEG_BYTES);

      const result = await toTeamsOutboundAttachments(
        [{ type: "image", data: PNG_BYTES, fetchData }],
        "send"
      );

      expect(fetchData).not.toHaveBeenCalled();
      expect(result).toEqual({
        attachments: [
          {
            contentType: "image/png",
            contentUrl: `data:image/png;base64,${PNG_BYTES.toString("base64")}`,
            name: undefined,
          },
        ],
        skipped: [],
      });
    });

    it("skips an attachment whose `fetchData` rejects, without falling back to the URL", async () => {
      const fetchData = vi.fn(() => Promise.reject(new Error("403")));

      const result = await toTeamsOutboundAttachments(
        [
          {
            type: "image",
            fetchData,
            url: "https://private.example.com/needs-auth.png",
            name: "shot.png",
          },
          { type: "image", url: "https://example.com/public.png" },
        ],
        "send"
      );

      expect(fetchData).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        attachments: [
          {
            contentType: "image/png",
            contentUrl: "https://example.com/public.png",
            name: undefined,
          },
        ],
        skipped: [{ index: 0, name: "shot.png", reason: "fetch-failed" }],
      });
    });

    it("skips an attachment whose `fetchData` throws synchronously", async () => {
      const result = await toTeamsOutboundAttachments(
        [
          {
            type: "image",
            fetchData: () => {
              throw new Error("boom");
            },
          },
        ],
        "send"
      );

      expect(result).toEqual({
        attachments: [],
        skipped: [{ index: 0, name: undefined, reason: "fetch-failed" }],
      });
    });

    it("skips data that can't be converted to bytes", async () => {
      const result = await toTeamsOutboundAttachments(
        [
          {
            type: "image",
            data: "raw string" as unknown as Buffer,
            url: "https://example.com/public.png",
          },
        ],
        "send"
      );

      expect(result).toEqual({
        attachments: [],
        skipped: [{ index: 0, name: undefined, reason: "fetch-failed" }],
      });
    });

    it.each([
      ["undefined", undefined],
      ["null", null],
    ])("skips an attachment whose `fetchData` resolves to %s, without falling back to the URL", async (_label, resolved) => {
      const fetchData = vi.fn(async () => resolved as unknown as Buffer);

      const result = await toTeamsOutboundAttachments(
        [
          {
            type: "image",
            fetchData,
            url: "https://example.com/public.png",
            name: "shot.png",
          },
        ],
        "send"
      );

      expect(fetchData).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        attachments: [],
        skipped: [{ index: 0, name: "shot.png", reason: "fetch-failed" }],
      });
    });

    it.each([
      ["an empty Buffer in `data`", { data: Buffer.alloc(0) }],
      ["an empty Blob in `data`", { data: new Blob([]) }],
      [
        "`fetchData` resolving to an empty Buffer",
        { fetchData: async () => Buffer.alloc(0) },
      ],
    ])("skips %s as no-content, without falling back to the URL", async (_label, source) => {
      const result = await toTeamsOutboundAttachments(
        [
          {
            type: "image",
            ...source,
            url: "https://example.com/public.png",
            mimeType: "image/png",
            name: "empty.png",
          },
        ],
        "send"
      );

      expect(result).toEqual({
        attachments: [],
        skipped: [{ index: 0, name: "empty.png", reason: "no-content" }],
      });
    });

    it("calls `fetchData` once when it resolves to an empty Buffer", async () => {
      const fetchData = vi.fn(async () => Buffer.alloc(0));

      const result = await toTeamsOutboundAttachments(
        [{ type: "image", fetchData }],
        "send"
      );

      expect(fetchData).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        attachments: [],
        skipped: [{ index: 0, name: undefined, reason: "no-content" }],
      });
    });

    it("keeps an image of a single byte", async () => {
      const result = await toTeamsOutboundAttachments(
        [{ type: "image", data: Buffer.from([0x00]), name: "dot" }],
        "send"
      );

      expect(result).toEqual({
        attachments: [
          {
            contentType: "image/png",
            contentUrl: "data:image/png;base64,AA==",
            name: "dot",
          },
        ],
        skipped: [],
      });
    });

    it("inlines bytes that sit next to a malformed URL", async () => {
      const result = await toTeamsOutboundAttachments(
        [{ type: "image", data: UNKNOWN_BYTES, url: "not a url" }],
        "send"
      );

      expect(result).toEqual({
        attachments: [
          {
            contentType: "image/png",
            contentUrl: `data:image/png;base64,${UNKNOWN_BYTES.toString("base64")}`,
            name: undefined,
          },
        ],
        skipped: [],
      });
    });

    it("keeps an image of exactly 1 MB", async () => {
      const bytes = Buffer.alloc(ONE_MEGABYTE, 7);

      const result = await toTeamsOutboundAttachments(
        [{ type: "image", data: bytes, mimeType: "image/png" }],
        "send"
      );

      expect(result).toEqual({
        attachments: [
          {
            contentType: "image/png",
            contentUrl: `data:image/png;base64,${bytes.toString("base64")}`,
            name: undefined,
          },
        ],
        skipped: [],
      });
      const decoded = decodeDataUri(result.attachments[0].contentUrl);
      expect(decoded.bytes.length).toBe(ONE_MEGABYTE);
      expect(decoded.bytes.equals(bytes)).toBe(true);
    });

    it("skips an image one byte over 1 MB, without falling back to the URL", async () => {
      const fetchData = vi.fn(async () => Buffer.alloc(ONE_MEGABYTE + 1, 7));

      const result = await toTeamsOutboundAttachments(
        [
          {
            type: "image",
            data: Buffer.alloc(ONE_MEGABYTE + 1, 7),
            mimeType: "image/png",
            name: "big-data.png",
          },
          {
            type: "image",
            fetchData,
            url: "https://example.com/big.png",
            name: "big-fetch.png",
          },
        ],
        "send"
      );

      expect(result).toEqual({
        attachments: [],
        skipped: [
          { index: 0, name: "big-data.png", reason: "too-large" },
          { index: 1, name: "big-fetch.png", reason: "too-large" },
        ],
      });
    });
  });

  describe("content type", () => {
    // Each name points at a different type than the bytes, so only the
    // signature can produce the expected result.
    it.each([
      ["PNG", PNG_BYTES, "misleading.gif", "image/png"],
      ["JPEG", JPEG_BYTES, "misleading.png", "image/jpeg"],
      ["GIF", GIF_BYTES, "misleading.jpg", "image/gif"],
    ])("reads %s from the bytes when there is no MIME type", async (_label, bytes, name, mimeType) => {
      const result = await toTeamsOutboundAttachments(
        [{ type: "image", data: bytes, name }],
        "send"
      );

      expect(result.attachments).toEqual([
        {
          contentType: mimeType,
          contentUrl: `data:${mimeType};base64,${bytes.toString("base64")}`,
          name,
        },
      ]);
    });

    it("types nameless JPEG bytes from `fetchData` as image/jpeg", async () => {
      const result = await toTeamsOutboundAttachments(
        [{ type: "image", fetchData: async () => JPEG_BYTES }],
        "send"
      );

      expect(result).toEqual({
        attachments: [
          {
            contentType: "image/jpeg",
            contentUrl: `data:image/jpeg;base64,${JPEG_BYTES.toString("base64")}`,
            name: undefined,
          },
        ],
        skipped: [],
      });
    });

    it.each([
      ["PNG", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "image/png"],
      ["JPEG", [0xff, 0xd8, 0xff], "image/jpeg"],
      ["GIF", [0x47, 0x49, 0x46, 0x38], "image/gif"],
    ])("reads %s from bytes that are only the signature", async (_label, signature, mimeType) => {
      const bytes = Buffer.from(signature);

      const result = await toTeamsOutboundAttachments(
        [{ type: "image", data: bytes, name: "misleading.webp" }],
        "send"
      );

      expect(result).toEqual({
        attachments: [
          {
            contentType: mimeType,
            contentUrl: `data:${mimeType};base64,${bytes.toString("base64")}`,
            name: "misleading.webp",
          },
        ],
        skipped: [],
      });
    });

    it.each([
      [
        "PNG signature with a wrong last byte",
        [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x00, 0x00, 0x00],
      ],
      [
        "PNG signature missing its last byte",
        [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a],
      ],
      ["JPEG signature with a wrong last byte", [0xff, 0xd8, 0x00, 0xe0]],
      ["GIF signature with a wrong last byte", [0x47, 0x49, 0x46, 0x00, 0x39]],
      ["GIF signature missing its last byte", [0x47, 0x49, 0x46]],
    ])("doesn't read a type from a %s", async (_label, prefix) => {
      const bytes = Buffer.from(prefix);

      const result = await toTeamsOutboundAttachments(
        [{ type: "image", data: bytes, name: "named.webp" }],
        "send"
      );

      expect(result).toEqual({
        attachments: [
          {
            contentType: "image/webp",
            contentUrl: `data:image/webp;base64,${bytes.toString("base64")}`,
            name: "named.webp",
          },
        ],
        skipped: [],
      });
    });

    it("prefers the given MIME type over the bytes", async () => {
      const result = await toTeamsOutboundAttachments(
        [{ type: "image", data: JPEG_BYTES, mimeType: "image/webp" }],
        "send"
      );

      expect(result).toEqual({
        attachments: [
          {
            contentType: "image/webp",
            contentUrl: `data:image/webp;base64,${JPEG_BYTES.toString("base64")}`,
            name: undefined,
          },
        ],
        skipped: [],
      });
    });

    it("falls back to the name, then image/png, for bytes it doesn't recognise", async () => {
      const result = await toTeamsOutboundAttachments(
        [
          { type: "image", data: UNKNOWN_BYTES, name: "photo.JPG" },
          { type: "image", data: UNKNOWN_BYTES },
          { type: "image", data: Buffer.from([0xff, 0xd8]) },
        ],
        "send"
      );

      const unknown = UNKNOWN_BYTES.toString("base64");
      expect(result).toEqual({
        attachments: [
          {
            contentType: "image/jpeg",
            contentUrl: `data:image/jpeg;base64,${unknown}`,
            name: "photo.JPG",
          },
          {
            contentType: "image/png",
            contentUrl: `data:image/png;base64,${unknown}`,
            name: undefined,
          },
          {
            contentType: "image/png",
            contentUrl: "data:image/png;base64,/9g=",
            name: undefined,
          },
        ],
        skipped: [],
      });
    });

    it.each([
      ["the name's extension", "photo.gif", "https://x.test/a", "image/gif"],
      [
        "the name before the URL",
        "photo.gif",
        "https://x.test/a.jpg",
        "image/gif",
      ],
      [
        "the URL pathname, not its query string",
        undefined,
        "https://x.test/a.jpg?size=png",
        "image/jpeg",
      ],
      [
        "the URL pathname when the name has no extension",
        "photo",
        "https://x.test/a.gif#frag.png",
        "image/gif",
      ],
      [
        "the URL pathname when the name's extension isn't an image",
        "report.pdf",
        "https://x.test/a.jpeg",
        "image/jpeg",
      ],
      [
        "image/png for an extensionless URL",
        undefined,
        "https://x.test/images/12345",
        "image/png",
      ],
      [
        "image/png when the only extension is in the query string",
        undefined,
        "https://x.test/render?file=a.jpg",
        "image/png",
      ],
      [
        "image/png when the extension isn't an image",
        "report.pdf",
        "https://x.test/report.pdf",
        "image/png",
      ],
    ])("infers a URL attachment's type from %s", async (_label, name, url, contentType) => {
      const result = await toTeamsOutboundAttachments(
        [{ type: "image", name, url }],
        "send"
      );

      expect(result).toEqual({
        attachments: [{ contentType, contentUrl: url, name }],
        skipped: [],
      });
    });
  });

  describe("edit mode", () => {
    it("keeps attachments sent by URL and never resolves bytes", async () => {
      const fetchData = vi.fn(async () => PNG_BYTES);

      const result = await toTeamsOutboundAttachments(
        [
          { type: "image", url: "https://example.com/a.jpg", name: "a.jpg" },
          {
            type: "image",
            data: PNG_BYTES,
            url: "https://example.com/b.png",
            name: "b.png",
          },
          {
            type: "image",
            fetchData,
            url: "https://example.com/c.png",
            name: "c.png",
          },
          { type: "image", url: "http://example.com/d.png", name: "d.png" },
          {
            type: "file",
            url: "https://example.com/e.pdf",
            mimeType: "application/pdf",
            name: "e.pdf",
          },
        ],
        "edit"
      );

      expect(fetchData).not.toHaveBeenCalled();
      expect(result).toEqual({
        attachments: [
          {
            contentType: "image/jpeg",
            contentUrl: "https://example.com/a.jpg",
            name: "a.jpg",
          },
        ],
        skipped: [
          { index: 1, name: "b.png", reason: "edit-no-upload" },
          { index: 2, name: "c.png", reason: "edit-no-upload" },
          { index: 3, name: "d.png", reason: "not-https" },
          { index: 4, name: "e.pdf", reason: "unsupported-type" },
        ],
      });
    });
  });

  it("keeps the order of what it sends and reports each skipped entry by index", async () => {
    const result = await toTeamsOutboundAttachments(
      [
        { type: "image", url: "https://example.com/1.png", name: "1.png" },
        { type: "video", url: "https://example.com/2.mp4", name: "2.mp4" },
        { type: "image", data: GIF_BYTES, name: "3.gif" },
        { type: "image" },
        { type: "image", url: "https://example.com/5.gif", name: "5.gif" },
      ],
      "send"
    );

    expect(result).toEqual({
      attachments: [
        {
          contentType: "image/png",
          contentUrl: "https://example.com/1.png",
          name: "1.png",
        },
        {
          contentType: "image/gif",
          contentUrl: `data:image/gif;base64,${GIF_BYTES.toString("base64")}`,
          name: "3.gif",
        },
        {
          contentType: "image/gif",
          contentUrl: "https://example.com/5.gif",
          name: "5.gif",
        },
      ],
      skipped: [
        { index: 1, name: "2.mp4", reason: "unsupported-type" },
        { index: 3, name: undefined, reason: "no-content" },
      ],
    });
  });

  it("returns nothing for an empty list", async () => {
    await expect(toTeamsOutboundAttachments([], "send")).resolves.toEqual({
      attachments: [],
      skipped: [],
    });
  });
});
