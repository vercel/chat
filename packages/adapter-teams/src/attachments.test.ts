import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAnonymousAttachmentFetchData,
  createTeamsAttachment,
  rehydrateTeamsAttachment,
  type TeamsAttachmentFetchers,
} from "./attachments";

const CONNECTOR_URL = "https://smba.trafficmanager.net/teams/";

function createFetchers(
  fetchAuthenticated: TeamsAttachmentFetchers["fetchAuthenticated"]
): TeamsAttachmentFetchers {
  return {
    createAnonymousFetchData: createAnonymousAttachmentFetchData,
    fetchAuthenticated,
  };
}

describe("Teams attachments", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("downloads file cards anonymously and infers their MIME type", async () => {
    const fetchAuthenticated = vi.fn();
    const anonymousFetch = vi.fn(async () => new Response("file contents"));
    vi.stubGlobal("fetch", anonymousFetch);
    const url = "https://smba.trafficmanager.net/teams/files/download";

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
      createFetchers(fetchAuthenticated)
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
    expect(anonymousFetch).toHaveBeenCalledWith(url);
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

  it("keeps cross-origin and HTTP inline attachments compatible and anonymous", async () => {
    const fetchAuthenticated = vi.fn();
    const anonymousFetch = vi.fn(async () => new Response("public image"));
    vi.stubGlobal("fetch", anonymousFetch);
    const urls = [
      "https://files.example.com/image.png",
      "http://smba.trafficmanager.net/teams/image.png",
    ];

    const attachments = urls.map((contentUrl) =>
      createTeamsAttachment(
        {
          contentType: "image/png",
          contentUrl,
          name: "image.png",
        },
        CONNECTOR_URL,
        createFetchers(fetchAuthenticated)
      )
    );

    expect(attachments).toMatchObject(
      urls.map((url) => ({
        type: "image",
        url,
        name: "image.png",
        mimeType: "image/png",
        fetchMetadata: { url },
      }))
    );
    await Promise.all(
      attachments.map((attachment) => attachment.fetchData?.())
    );
    expect(anonymousFetch).toHaveBeenCalledTimes(2);
    expect(fetchAuthenticated).not.toHaveBeenCalled();
  });

  it("rehydrates both retrieval modes and revalidates bot destinations", async () => {
    const fetchAuthenticated = vi.fn(async () =>
      Buffer.from("rehydrated image")
    );
    const anonymousFetch = vi.fn(async () => new Response("anonymous file"));
    vi.stubGlobal("fetch", anonymousFetch);
    const fetchers = createFetchers(fetchAuthenticated);
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
    expect(anonymousFetch).toHaveBeenCalledWith(anonymousUrl);
  });
});
