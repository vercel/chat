import { describe, expect, it, vi } from "vitest";
import {
  createAnonymousAttachmentFetchData,
  createTeamsAttachment,
  rehydrateTeamsAttachment,
  type TeamsAttachmentFetchers,
} from "./attachments";

const CONNECTOR_URL = "https://smba.trafficmanager.net/teams/";

function createFetchers(
  fetchAuthenticated: TeamsAttachmentFetchers["fetchAuthenticated"],
  transfer?: (url: string) => Promise<Buffer>
): TeamsAttachmentFetchers {
  return {
    createAnonymousFetchData: transfer
      ? (url) => () => transfer(url)
      : createAnonymousAttachmentFetchData,
    fetchAuthenticated,
  };
}

describe("Teams attachments", () => {
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
