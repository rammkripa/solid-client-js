/**
 * Copyright 2020 Inrupt Inc.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to use,
 * copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the
 * Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
 * INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
 * PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
 * HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
 * OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
 * SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

import { jest, describe, it } from "@jest/globals";
import { IriString, SolidDataset, WithServerResourceInfo } from "../interfaces";
import { getAgentResourceAccess } from "../acl/agent";
import {
  getAgentAccess,
  getAgentAccessAll,
  getGroupAccess,
  getGroupAccessAll,
  getPublicAccess,
  setAgentResourceAccess,
  WacAccess,
} from "./wac";
import { Response } from "cross-fetch";
import { triplesToTurtle } from "../formats/turtle";
import { addMockAclRuleQuads } from "../acl/mock.internal";
import { acl, foaf } from "../constants";
import { setMockAclUrl } from "../acl/mock.internal";

jest.mock("../fetcher.ts", () => ({
  fetch: jest.fn().mockImplementation(() =>
    Promise.resolve(
      new Response(undefined, {
        headers: { Location: "https://arbitrary.pod/resource" },
      })
    )
  ),
}));

import { mockSolidDatasetFrom } from "../resource/mock";
import { AgentAccess } from "../acl/agent";
import { internal_getResourceAcl } from "../acl/acl.internal";
import { Access, AclDataset } from "../acl/acl";

function getMockDataset(
  sourceIri: IriString,
  aclIri?: IriString
): SolidDataset & WithServerResourceInfo {
  const result = mockSolidDatasetFrom(sourceIri);
  if (aclIri === undefined) {
    return result;
  }
  return setMockAclUrl(result, aclIri);
}

function mockResponse(
  body?: BodyInit | null,
  init?: ResponseInit & { url: string }
): Response {
  return new Response(body, init);
}

describe("getAgentAccess", () => {
  it("calls the included fetcher by default", async () => {
    const mockedFetcher = jest.requireMock("../fetcher.ts") as {
      fetch: jest.Mock<
        ReturnType<typeof window.fetch>,
        [RequestInfo, RequestInit?]
      >;
    };

    const resource = getMockDataset(
      "https://some.pod/resource",
      "https://some.pod/resource.acl"
    );
    await getAgentAccess(resource, "https://some.pod/profile#agent");

    expect(mockedFetcher.fetch.mock.calls[0][0]).toEqual(
      "https://some.pod/resource.acl"
    );
  });

  it("returns null if no ACL is accessible", async () => {
    const mockFetch = jest
      .fn(window.fetch)
      // No resource ACL available...
      .mockResolvedValueOnce(
        mockResponse("", {
          status: 404,
          url: "https://some.pod/resource.acl",
        })
      )
      // Link to the fallback ACL...
      .mockResolvedValueOnce(
        mockResponse("", {
          status: 200,
          url: "https://some.pod/",
          headers: {
            Link: '<.acl>; rel="acl"',
          },
        })
      )
      // Get the fallback ACL
      .mockResolvedValueOnce(
        mockResponse("", {
          status: 404,
          url: "https://some.pod/.acl",
        })
      );

    const resource = getMockDataset(
      "https://some.pod/resource",
      "https://some.pod/resource.acl"
    );
    const result = getAgentAccess(resource, "https://some.pod/profile#agent", {
      fetch: mockFetch,
    });

    await expect(result).resolves.toBeNull();
  });

  it("returns null if no ACL is advertised by the target resource", async () => {
    const mockFetch = jest.fn(window.fetch).mockResolvedValue(
      mockResponse("ACL not found", {
        status: 404,
        url: "https://some.pod/resource.acl",
      })
    );

    const resource = getMockDataset("https://some.pod/resource");
    const result = getAgentAccess(resource, "https://some.pod/profile#agent", {
      fetch: mockFetch,
    });

    await expect(result).resolves.toBeNull();
  });

  it("fetches the resource ACL if available", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      "https://some.pod/profile#agent",
      "https://some.pod/resource",
      { read: true, append: false, write: false, control: false },
      "resource"
    );

    const mockFetch = jest.fn(window.fetch).mockResolvedValue(
      mockResponse(await triplesToTurtle(Array.from(aclResource)), {
        status: 200,
        url: "https://some.pod/resource.acl",
      })
    );

    const resource = getMockDataset(
      "https://some.pod/resource",
      "https://some.pod/resource.acl"
    );
    const result = getAgentAccess(resource, "https://some.pod/profile#agent", {
      fetch: mockFetch,
    });

    await expect(result).resolves.toStrictEqual({
      read: true,
      append: undefined,
      write: undefined,
      controlRead: undefined,
      controlWrite: undefined,
    });
  });

  it("fetches the fallback ACL if no resource ACL is available", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/.acl"),
      "https://some.pod/profile#agent",
      "https://some.pod/",
      { read: true, append: false, write: false, control: false },
      "default"
    );

    const mockFetch = jest
      .fn(window.fetch)
      // No resource ACL available...
      .mockResolvedValueOnce(
        mockResponse("", {
          status: 404,
          url: "https://some.pod/resource.acl",
        })
      )
      // Link to the fallback ACL...
      .mockResolvedValueOnce(
        mockResponse("", {
          status: 200,
          url: "https://some.pod/",
          headers: {
            Link: '<.acl>; rel="acl"',
          },
        })
      )
      // Get the fallback ACL
      .mockResolvedValueOnce(
        mockResponse(await triplesToTurtle(Array.from(aclResource)), {
          status: 200,
          url: "https://some.pod/.acl",
        })
      );

    const resource = getMockDataset(
      "https://some.pod/resource",
      "https://some.pod/resource.acl"
    );
    const result = getAgentAccess(resource, "https://some.pod/profile#agent", {
      fetch: mockFetch,
    });
    await expect(result).resolves.toStrictEqual({
      read: true,
      append: undefined,
      write: undefined,
      controlRead: undefined,
      controlWrite: undefined,
    });
  });

  it("ignores the fallback ACL if the resource ACL is available", async () => {
    const fallbackAclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/.acl"),
      "https://some.pod/profile#agent",
      "https://some.pod/",
      { read: false, append: true, write: false, control: false },
      "default"
    );

    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      "https://some.pod/profile#agent",
      "https://some.pod/resource",
      { read: true, append: false, write: false, control: false },
      "resource"
    );

    const mockFetch = jest
      .fn(window.fetch)
      // The resource ACL is available...
      .mockResolvedValueOnce(
        mockResponse(await triplesToTurtle(Array.from(aclResource)), {
          status: 200,
          url: "https://some.pod/resource.acl",
        })
      )
      // Link to the fallback ACL...
      .mockResolvedValueOnce(
        mockResponse("", {
          status: 200,
          url: "https://some.pod/",
          headers: {
            Link: '<.acl>; rel="acl"',
          },
        })
      )
      // Get the fallback ACL
      .mockResolvedValueOnce(
        mockResponse(await triplesToTurtle(Array.from(fallbackAclResource)), {
          status: 200,
          url: "https://some.pod/.acl",
        })
      );

    const resource = getMockDataset(
      "https://some.pod/resource",
      "https://some.pod/resource.acl"
    );
    const result = getAgentAccess(resource, "https://some.pod/profile#agent", {
      fetch: mockFetch,
    });
    await expect(result).resolves.toStrictEqual({
      append: undefined,
      read: true,
      write: undefined,
      controlRead: undefined,
      controlWrite: undefined,
    });
  });

  it("returns true for both controlRead and controlWrite if the Agent has control access", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      "https://some.pod/profile#agent",
      "https://some.pod/resource",
      { read: false, append: false, write: false, control: true },
      "resource"
    );

    const mockFetch = jest.fn(window.fetch).mockResolvedValue(
      mockResponse(await triplesToTurtle(Array.from(aclResource)), {
        status: 200,
        url: "https://some.pod/resource.acl",
      })
    );

    const resource = getMockDataset(
      "https://some.pod/resource",
      "https://some.pod/resource.acl"
    );
    const result = getAgentAccess(resource, "https://some.pod/profile#agent", {
      fetch: mockFetch,
    });

    await expect(result).resolves.toStrictEqual({
      read: undefined,
      append: undefined,
      write: undefined,
      controlRead: true,
      controlWrite: true,
    });
  });

  it("correctly reads the Agent append access", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      "https://some.pod/profile#agent",
      "https://some.pod/resource",
      { read: false, append: true, write: false, control: false },
      "resource"
    );

    const mockFetch = jest.fn(window.fetch).mockResolvedValue(
      mockResponse(await triplesToTurtle(Array.from(aclResource)), {
        status: 200,
        url: "https://some.pod/resource.acl",
      })
    );

    const resource = getMockDataset(
      "https://some.pod/resource",
      "https://some.pod/resource.acl"
    );
    const result = getAgentAccess(resource, "https://some.pod/profile#agent", {
      fetch: mockFetch,
    });

    await expect(result).resolves.toStrictEqual({
      read: undefined,
      append: true,
      write: undefined,
      controlRead: undefined,
      controlWrite: undefined,
    });
  });

  it("correctly reads the Agent write access, which implies append", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      "https://some.pod/profile#agent",
      "https://some.pod/resource",
      { read: false, append: false, write: true, control: false },
      "resource"
    );

    const mockFetch = jest.fn(window.fetch).mockResolvedValue(
      mockResponse(await triplesToTurtle(Array.from(aclResource)), {
        status: 200,
        url: "https://some.pod/resource.acl",
      })
    );

    const resource = getMockDataset(
      "https://some.pod/resource",
      "https://some.pod/resource.acl"
    );
    const result = getAgentAccess(resource, "https://some.pod/profile#agent", {
      fetch: mockFetch,
    });

    await expect(result).resolves.toStrictEqual({
      read: undefined,
      append: true,
      write: true,
      controlRead: undefined,
      controlWrite: undefined,
    });
  });

  it("returns undefined for all modes the Agent isn't present", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      "https://some.pod/profile#another-agent",
      "https://some.pod/resource",
      { read: true, append: false, write: false, control: false },
      "resource"
    );

    const mockFetch = jest.fn(window.fetch).mockResolvedValue(
      mockResponse(await triplesToTurtle(Array.from(aclResource)), {
        status: 200,
        url: "https://some.pod/resource.acl",
      })
    );

    const resource = getMockDataset(
      "https://some.pod/resource",
      "https://some.pod/resource.acl"
    );
    const result = getAgentAccess(resource, "https://some.pod/profile#agent", {
      fetch: mockFetch,
    });

    await expect(result).resolves.toStrictEqual({
      read: undefined,
      append: undefined,
      write: undefined,
      controlRead: undefined,
      controlWrite: undefined,
    });
  });

  it("does not return access for groups", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      "https://some.pod/profile#agent",
      "https://some.pod/resource",
      { read: true, append: false, write: false, control: false },
      "resource",
      "https://some.pod/resource.acl#some-rule",
      acl.agentGroup
    );

    const mockFetch = jest.fn(window.fetch).mockResolvedValue(
      mockResponse(await triplesToTurtle(Array.from(aclResource)), {
        status: 200,
        url: "https://some.pod/resource.acl",
      })
    );

    const resource = getMockDataset(
      "https://some.pod/resource",
      "https://some.pod/resource.acl"
    );
    const result = getAgentAccess(resource, "https://some.pod/profile#agent", {
      fetch: mockFetch,
    });

    await expect(result).resolves.toStrictEqual({
      read: undefined,
      append: undefined,
      write: undefined,
      controlRead: undefined,
      controlWrite: undefined,
    });
  });

  it("does not return access for everyone", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      foaf.Agent,
      "https://some.pod/resource",
      { read: true, append: false, write: false, control: false },
      "resource",
      "https://some.pod/resource.acl#some-rule",
      acl.agentClass
    );

    const mockFetch = jest.fn(window.fetch).mockResolvedValue(
      mockResponse(await triplesToTurtle(Array.from(aclResource)), {
        status: 200,
        url: "https://some.pod/resource.acl",
      })
    );

    const resource = getMockDataset(
      "https://some.pod/resource",
      "https://some.pod/resource.acl"
    );
    const result = getAgentAccess(resource, "https://some.pod/profile#agent", {
      fetch: mockFetch,
    });

    await expect(result).resolves.toStrictEqual({
      read: undefined,
      append: undefined,
      write: undefined,
      controlRead: undefined,
      controlWrite: undefined,
    });
  });

  it("does not return access for authenticated agents", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      acl.AuthenticatedAgent,
      "https://some.pod/resource",
      { read: true, append: false, write: false, control: false },
      "resource",
      "https://some.pod/resource.acl#some-rule",
      acl.agentClass
    );

    const mockFetch = jest.fn(window.fetch).mockResolvedValue(
      mockResponse(await triplesToTurtle(Array.from(aclResource)), {
        status: 200,
        url: "https://some.pod/resource.acl",
      })
    );

    const resource = getMockDataset(
      "https://some.pod/resource",
      "https://some.pod/resource.acl"
    );
    const result = getAgentAccess(resource, "https://some.pod/profile#agent", {
      fetch: mockFetch,
    });

    await expect(result).resolves.toStrictEqual({
      read: undefined,
      append: undefined,
      write: undefined,
      controlRead: undefined,
      controlWrite: undefined,
    });
  });
});

describe("getGroupAccess", () => {
  it("calls the included fetcher by default", async () => {
    const mockedFetcher = jest.requireMock("../fetcher.ts") as {
      fetch: jest.Mock<
        ReturnType<typeof window.fetch>,
        [RequestInfo, RequestInit?]
      >;
    };

    const resource = getMockDataset(
      "https://some.pod/resource",
      "https://some.pod/resource.acl"
    );
    await getGroupAccess(resource, "https://some.pod/groups#group");

    expect(mockedFetcher.fetch.mock.calls[0][0]).toEqual(
      "https://some.pod/resource.acl"
    );
  });

  it("returns null if no ACL is accessible", async () => {
    const mockFetch = jest
      .fn(window.fetch)
      // No resource ACL available...
      .mockResolvedValueOnce(
        mockResponse("", {
          status: 404,
          url: "https://some.pod/resource.acl",
        })
      )
      // Link to the fallback ACL...
      .mockResolvedValueOnce(
        mockResponse("", {
          status: 200,
          url: "https://some.pod/",
          headers: {
            Link: '<.acl>; rel="acl"',
          },
        })
      )
      // Get the fallback ACL
      .mockResolvedValueOnce(
        mockResponse("", {
          status: 404,
          url: "https://some.pod/.acl",
        })
      );

    const resource = getMockDataset(
      "https://some.pod/resource",
      "https://some.pod/resource.acl"
    );
    const result = getGroupAccess(resource, "https://some.pod/groups#group", {
      fetch: mockFetch,
    });

    await expect(result).resolves.toBeNull();
  });

  it("returns null if no ACL is advertised by the target resource", async () => {
    const mockFetch = jest.fn(window.fetch).mockResolvedValue(
      mockResponse("ACL not found", {
        status: 404,
        url: "https://some.pod/resource.acl",
      })
    );

    const resource = getMockDataset("https://some.pod/resource");
    const result = getAgentAccess(resource, "https://some.pod/groups#group", {
      fetch: mockFetch,
    });

    await expect(result).resolves.toBeNull();
  });

  it("fetches the resource ACL if available", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      "https://some.pod/groups#group",
      "https://some.pod/resource",
      { read: true, append: false, write: false, control: false },
      "resource",
      "https://some.pod/resource.acl#some-rule",
      acl.agentGroup
    );

    const mockFetch = jest.fn(window.fetch).mockResolvedValue(
      mockResponse(await triplesToTurtle(Array.from(aclResource)), {
        status: 200,
        url: "https://some.pod/resource.acl",
      })
    );

    const resource = getMockDataset(
      "https://some.pod/resource",
      "https://some.pod/resource.acl"
    );
    const result = getGroupAccess(resource, "https://some.pod/groups#group", {
      fetch: mockFetch,
    });

    await expect(result).resolves.toStrictEqual({
      read: true,
      append: undefined,
      write: undefined,
      controlRead: undefined,
      controlWrite: undefined,
    });
  });

  it("fetches the fallback ACL if no resource ACL is available", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/.acl"),
      "https://some.pod/groups#group",
      "https://some.pod/",
      { read: true, append: false, write: false, control: false },
      "default",
      "https://some.pod/resource.acl#some-rule",
      acl.agentGroup
    );

    const mockFetch = jest
      .fn(window.fetch)
      // No resource ACL available...
      .mockResolvedValueOnce(
        mockResponse("", {
          status: 404,
          url: "https://some.pod/resource.acl",
        })
      )
      // Link to the fallback ACL...
      .mockResolvedValueOnce(
        mockResponse("", {
          status: 200,
          url: "https://some.pod/",
          headers: {
            Link: '<.acl>; rel="acl"',
          },
        })
      )
      // Get the fallback ACL
      .mockResolvedValueOnce(
        mockResponse(await triplesToTurtle(Array.from(aclResource)), {
          status: 200,
          url: "https://some.pod/.acl",
        })
      );

    const resource = getMockDataset(
      "https://some.pod/resource",
      "https://some.pod/resource.acl"
    );
    const result = getGroupAccess(resource, "https://some.pod/groups#group", {
      fetch: mockFetch,
    });
    await expect(result).resolves.toStrictEqual({
      read: true,
      append: undefined,
      write: undefined,
      controlRead: undefined,
      controlWrite: undefined,
    });
  });

  it("ignores the fallback ACL if the resource ACL is available", async () => {
    const fallbackAclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/.acl"),
      "https://some.pod/groups#group",
      "https://some.pod/",
      { read: true, append: false, write: false, control: false },
      "default",
      "https://some.pod/resource.acl#some-rule",
      acl.agentGroup
    );

    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      "https://some.pod/groups#group",
      "https://some.pod/resource",
      { read: false, append: true, write: false, control: false },
      "resource",
      "https://some.pod/resource.acl#some-rule",
      acl.agentGroup
    );

    const mockFetch = jest
      .fn(window.fetch)
      // The resource ACL is available...
      .mockResolvedValueOnce(
        mockResponse(await triplesToTurtle(Array.from(aclResource)), {
          status: 200,
          url: "https://some.pod/resource.acl",
        })
      )
      // Link to the fallback ACL...
      .mockResolvedValueOnce(
        mockResponse("", {
          status: 200,
          url: "https://some.pod/",
          headers: {
            Link: '<.acl>; rel="acl"',
          },
        })
      )
      // Get the fallback ACL
      .mockResolvedValueOnce(
        mockResponse(await triplesToTurtle(Array.from(fallbackAclResource)), {
          status: 200,
          url: "https://some.pod/.acl",
        })
      );

    const resource = getMockDataset(
      "https://some.pod/resource",
      "https://some.pod/resource.acl"
    );
    const result = getGroupAccess(resource, "https://some.pod/groups#group", {
      fetch: mockFetch,
    });
    await expect(result).resolves.toStrictEqual({
      append: true,
      read: undefined,
      write: undefined,
      controlRead: undefined,
      controlWrite: undefined,
    });
  });

  it("returns an empty object if the group isn't present", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      "https://some.pod/groups#another-group",
      "https://some.pod/resource",
      { read: true, append: false, write: false, control: false },
      "resource",
      "https://some.pod/resource.acl#some-rule",
      acl.agentGroup
    );

    const mockFetch = jest.fn(window.fetch).mockResolvedValue(
      mockResponse(await triplesToTurtle(Array.from(aclResource)), {
        status: 200,
        url: "https://some.pod/resource.acl",
      })
    );

    const resource = getMockDataset(
      "https://some.pod/resource",
      "https://some.pod/resource.acl"
    );
    const result = getGroupAccess(resource, "https://some.pod/groups#group", {
      fetch: mockFetch,
    });

    await expect(result).resolves.toStrictEqual({
      read: undefined,
      append: undefined,
      write: undefined,
      controlRead: undefined,
      controlWrite: undefined,
    });
  });

  it("does not return access for agents", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      "https://some.pod/groups#group",
      "https://some.pod/resource",
      { read: true, append: false, write: false, control: false },
      "resource",
      "https://some.pod/resource.acl#some-rule",
      acl.agent
    );

    const mockFetch = jest.fn(window.fetch).mockResolvedValue(
      mockResponse(await triplesToTurtle(Array.from(aclResource)), {
        status: 200,
        url: "https://some.pod/resource.acl",
      })
    );

    const resource = getMockDataset(
      "https://some.pod/resource",
      "https://some.pod/resource.acl"
    );
    const result = getGroupAccess(resource, "https://some.pod/groups#group", {
      fetch: mockFetch,
    });

    await expect(result).resolves.toStrictEqual({
      read: undefined,
      append: undefined,
      write: undefined,
      controlRead: undefined,
      controlWrite: undefined,
    });
  });

  it("does not return access for everyone", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      foaf.Agent,
      "https://some.pod/resource",
      { read: true, append: false, write: false, control: false },
      "resource",
      "https://some.pod/resource.acl#some-rule",
      acl.agentClass
    );

    const mockFetch = jest.fn(window.fetch).mockResolvedValue(
      mockResponse(await triplesToTurtle(Array.from(aclResource)), {
        status: 200,
        url: "https://some.pod/resource.acl",
      })
    );

    const resource = getMockDataset(
      "https://some.pod/resource",
      "https://some.pod/resource.acl"
    );
    const result = getGroupAccess(resource, "https://some.pod/groups#group", {
      fetch: mockFetch,
    });

    await expect(result).resolves.toStrictEqual({
      read: undefined,
      append: undefined,
      write: undefined,
      controlRead: undefined,
      controlWrite: undefined,
    });
  });

  it("does not return access for authenticated agents", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      acl.AuthenticatedAgent,
      "https://some.pod/resource",
      { read: true, append: false, write: false, control: false },
      "resource",
      "https://some.pod/resource.acl#some-rule",
      acl.agentClass
    );

    const mockFetch = jest.fn(window.fetch).mockResolvedValue(
      mockResponse(await triplesToTurtle(Array.from(aclResource)), {
        status: 200,
        url: "https://some.pod/resource.acl",
      })
    );

    const resource = getMockDataset(
      "https://some.pod/resource",
      "https://some.pod/resource.acl"
    );
    const result = getGroupAccess(resource, "https://some.pod/groups#group", {
      fetch: mockFetch,
    });

    await expect(result).resolves.toStrictEqual({
      read: undefined,
      append: undefined,
      write: undefined,
      controlRead: undefined,
      controlWrite: undefined,
    });
  });
});

describe("getPublicAccess", () => {
  it("calls the included fetcher by default", async () => {
    const mockedFetcher = jest.requireMock("../fetcher.ts") as {
      fetch: jest.Mock<
        ReturnType<typeof window.fetch>,
        [RequestInfo, RequestInit?]
      >;
    };

    const resource = getMockDataset(
      "https://some.pod/resource",
      "https://some.pod/resource.acl"
    );
    await getPublicAccess(resource);

    expect(mockedFetcher.fetch.mock.calls[0][0]).toEqual(
      "https://some.pod/resource.acl"
    );
  });

  it("returns null if no ACL is accessible", async () => {
    const mockFetch = jest
      .fn(window.fetch)
      // No resource ACL available...
      .mockResolvedValueOnce(
        mockResponse("", {
          status: 404,
          url: "https://some.pod/resource.acl",
        })
      )
      // Link to the fallback ACL...
      .mockResolvedValueOnce(
        mockResponse("", {
          status: 200,
          url: "https://some.pod/",
          headers: {
            Link: '<.acl>; rel="acl"',
          },
        })
      )
      // Get the fallback ACL
      .mockResolvedValueOnce(
        mockResponse("", {
          status: 404,
          url: "https://some.pod/.acl",
        })
      );

    const resource = getMockDataset(
      "https://some.pod/resource",
      "https://some.pod/resource.acl"
    );
    const result = getPublicAccess(resource, {
      fetch: mockFetch,
    });

    await expect(result).resolves.toBeNull();
  });

  it("returns null if no ACL is advertised by the target resource", async () => {
    const mockFetch = jest.fn(window.fetch).mockResolvedValue(
      mockResponse("ACL not found", {
        status: 404,
        url: "https://some.pod/resource.acl",
      })
    );

    const resource = getMockDataset("https://some.pod/resource");
    const result = getPublicAccess(resource, {
      fetch: mockFetch,
    });

    await expect(result).resolves.toBeNull();
  });

  it("fetches the resource ACL if available", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      foaf.Agent,
      "https://some.pod/resource",
      { read: true, append: false, write: false, control: false },
      "resource",
      "https://some.pod/resource.acl#some-rule",
      acl.agentClass
    );

    const mockFetch = jest.fn(window.fetch).mockResolvedValue(
      mockResponse(await triplesToTurtle(Array.from(aclResource)), {
        status: 200,
        url: "https://some.pod/resource.acl",
      })
    );

    const resource = getMockDataset(
      "https://some.pod/resource",
      "https://some.pod/resource.acl"
    );
    const result = getPublicAccess(resource, {
      fetch: mockFetch,
    });

    await expect(result).resolves.toStrictEqual({
      read: true,
      append: undefined,
      write: undefined,
      controlRead: undefined,
      controlWrite: undefined,
    });
  });

  it("fetches the fallback ACL if no resource ACL is available", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/.acl"),
      foaf.Agent,
      "https://some.pod/",
      { read: true, append: false, write: false, control: false },
      "default",
      "https://some.pod/resource.acl#some-rule",
      acl.agentClass
    );

    const mockFetch = jest
      .fn(window.fetch)
      // No resource ACL available...
      .mockResolvedValueOnce(
        mockResponse("", {
          status: 404,
          url: "https://some.pod/resource.acl",
        })
      )
      // Link to the fallback ACL...
      .mockResolvedValueOnce(
        mockResponse("", {
          status: 200,
          url: "https://some.pod/",
          headers: {
            Link: '<.acl>; rel="acl"',
          },
        })
      )
      // Get the fallback ACL
      .mockResolvedValueOnce(
        mockResponse(await triplesToTurtle(Array.from(aclResource)), {
          status: 200,
          url: "https://some.pod/.acl",
        })
      );

    const resource = getMockDataset(
      "https://some.pod/resource",
      "https://some.pod/resource.acl"
    );
    const result = getPublicAccess(resource, {
      fetch: mockFetch,
    });
    await expect(result).resolves.toStrictEqual({
      read: true,
      append: undefined,
      write: undefined,
      controlRead: undefined,
      controlWrite: undefined,
    });
  });

  it("ignores the fallback ACL if the resource ACL is available", async () => {
    const fallbackAclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/.acl"),
      foaf.Agent,
      "https://some.pod/",
      { read: true, append: false, write: false, control: false },
      "default",
      "https://some.pod/resource.acl#some-rule",
      acl.agentClass
    );

    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      foaf.Agent,
      "https://some.pod/resource",
      { read: false, append: true, write: false, control: false },
      "resource",
      "https://some.pod/resource.acl#some-rule",
      acl.agentClass
    );

    const mockFetch = jest
      .fn(window.fetch)
      // The resource ACL is available...
      .mockResolvedValueOnce(
        mockResponse(await triplesToTurtle(Array.from(aclResource)), {
          status: 200,
          url: "https://some.pod/resource.acl",
        })
      )
      // Link to the fallback ACL...
      .mockResolvedValueOnce(
        mockResponse("", {
          status: 200,
          url: "https://some.pod/",
          headers: {
            Link: '<.acl>; rel="acl"',
          },
        })
      )
      // Get the fallback ACL
      .mockResolvedValueOnce(
        mockResponse(await triplesToTurtle(Array.from(fallbackAclResource)), {
          status: 200,
          url: "https://some.pod/.acl",
        })
      );

    const resource = getMockDataset(
      "https://some.pod/resource",
      "https://some.pod/resource.acl"
    );
    const result = getPublicAccess(resource, {
      fetch: mockFetch,
    });
    await expect(result).resolves.toStrictEqual({
      append: true,
      read: undefined,
      write: undefined,
      controlRead: undefined,
      controlWrite: undefined,
    });
  });

  it("returns an empty object if no public access is specified", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      foaf.Agent,
      "https://some.pod/resource",
      { read: false, append: false, write: false, control: false },
      "resource",
      "https://some.pod/resource.acl#some-rule",
      acl.agentClass
    );

    const mockFetch = jest.fn(window.fetch).mockResolvedValue(
      mockResponse(await triplesToTurtle(Array.from(aclResource)), {
        status: 200,
        url: "https://some.pod/resource.acl",
      })
    );

    const resource = getMockDataset(
      "https://some.pod/resource",
      "https://some.pod/resource.acl"
    );
    const result = getPublicAccess(resource, {
      fetch: mockFetch,
    });

    await expect(result).resolves.toStrictEqual({
      read: undefined,
      append: undefined,
      write: undefined,
      controlRead: undefined,
      controlWrite: undefined,
    });
  });

  it("does not return access for agents", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      foaf.Agent,
      "https://some.pod/resource",
      { read: true, append: false, write: false, control: false },
      "resource",
      "https://some.pod/resource.acl#some-rule",
      acl.agent
    );

    const mockFetch = jest.fn(window.fetch).mockResolvedValue(
      mockResponse(await triplesToTurtle(Array.from(aclResource)), {
        status: 200,
        url: "https://some.pod/resource.acl",
      })
    );

    const resource = getMockDataset(
      "https://some.pod/resource",
      "https://some.pod/resource.acl"
    );
    const result = getPublicAccess(resource, {
      fetch: mockFetch,
    });

    await expect(result).resolves.toStrictEqual({
      read: undefined,
      append: undefined,
      write: undefined,
      controlRead: undefined,
      controlWrite: undefined,
    });
  });

  it("does not return access for groups", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      foaf.Agent,
      "https://some.pod/resource",
      { read: true, append: false, write: false, control: false },
      "resource",
      "https://some.pod/resource.acl#some-rule",
      acl.agentGroup
    );

    const mockFetch = jest.fn(window.fetch).mockResolvedValue(
      mockResponse(await triplesToTurtle(Array.from(aclResource)), {
        status: 200,
        url: "https://some.pod/resource.acl",
      })
    );

    const resource = getMockDataset(
      "https://some.pod/resource",
      "https://some.pod/resource.acl"
    );
    const result = getPublicAccess(resource, {
      fetch: mockFetch,
    });

    await expect(result).resolves.toStrictEqual({
      read: undefined,
      append: undefined,
      write: undefined,
      controlRead: undefined,
      controlWrite: undefined,
    });
  });

  it("does not return access for authenticated agents", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      acl.AuthenticatedAgent,
      "https://some.pod/resource",
      { read: true, append: false, write: false, control: false },
      "resource",
      "https://some.pod/resource.acl#some-rule",
      acl.agentClass
    );

    const mockFetch = jest.fn(window.fetch).mockResolvedValue(
      mockResponse(await triplesToTurtle(Array.from(aclResource)), {
        status: 200,
        url: "https://some.pod/resource.acl",
      })
    );

    const resource = getMockDataset(
      "https://some.pod/resource",
      "https://some.pod/resource.acl"
    );
    const result = getPublicAccess(resource, {
      fetch: mockFetch,
    });

    await expect(result).resolves.toStrictEqual({
      read: undefined,
      append: undefined,
      write: undefined,
      controlRead: undefined,
      controlWrite: undefined,
    });
  });
});

describe("getAgentAccessAll", () => {
  it("uses the default fetcher if none is provided", async () => {
    const mockedFetcher = jest.requireMock("../fetcher.ts") as {
      fetch: jest.Mock<
        ReturnType<typeof window.fetch>,
        [RequestInfo, RequestInit?]
      >;
    };

    const resource = getMockDataset(
      "https://some.pod/resource",
      "https://some.pod/resource.acl"
    );
    await getAgentAccessAll(resource);

    expect(mockedFetcher.fetch.mock.calls[0][0]).toEqual(
      "https://some.pod/resource.acl"
    );
  });

  it("returns null if the advertized ACL isn't accessible", async () => {
    const mockFetch = jest
      .fn(window.fetch)
      // No resource ACL available...
      .mockResolvedValueOnce(
        mockResponse("", {
          status: 404,
          url: "https://some.pod/resource.acl",
        })
      )
      // Link to the fallback ACL...
      .mockResolvedValueOnce(
        mockResponse("", {
          status: 200,
          url: "https://some.pod/",
          headers: {
            Link: '<.acl>; rel="acl"',
          },
        })
      )
      // Get the fallback ACL
      .mockResolvedValueOnce(
        mockResponse("", {
          status: 404,
          url: "https://some.pod/.acl",
        })
      );

    const resource = getMockDataset(
      "https://some.pod/resource",
      "https://some.pod/resource.acl"
    );
    const result = getAgentAccessAll(resource, {
      fetch: mockFetch,
    });

    await expect(result).resolves.toBeNull();
  });

  it("returns null if no ACL is advertised by the resource", async () => {
    const mockFetch = jest.fn(window.fetch).mockResolvedValue(
      mockResponse("ACL not found", {
        status: 404,
        url: "https://some.pod/resource.acl",
      })
    );

    const resource = getMockDataset("https://some.pod/resource");
    const result = getAgentAccessAll(resource, {
      fetch: mockFetch,
    });

    await expect(result).resolves.toBeNull();
  });

  it("calls the underlying getAgentAccessAll", async () => {
    const mockFetch = jest.fn(window.fetch).mockResolvedValue(
      mockResponse("", {
        status: 200,
        url: "https://some.pod/resource.acl",
      })
    );

    const wacModule = jest.requireActual("../acl/agent") as {
      getAgentAccessAll: () => Promise<AgentAccess>;
    };
    const getAgentAccessAllWac = jest.spyOn(wacModule, "getAgentAccessAll");

    const resource = getMockDataset(
      "https://some.pod/resource",
      "https://some.pod/resource.acl"
    );
    await getAgentAccessAll(resource, {
      fetch: mockFetch,
    });

    expect(getAgentAccessAllWac).toHaveBeenCalled();
  });

  it("returns an empty list if the ACL defines no access", async () => {
    const mockFetch = jest.fn(window.fetch).mockResolvedValue(
      mockResponse("", {
        status: 200,
        url: "https://some.pod/resource.acl",
      })
    );
    const resource = getMockDataset(
      "https://some.pod/resource",
      "https://some.pod/resource.acl"
    );
    await expect(
      getAgentAccessAll(resource, {
        fetch: mockFetch,
      })
    ).resolves.toStrictEqual({});
  });

  it("returns the access set for all the actors present", async () => {
    let aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      "https://some.pod/profile#agent-a",
      "https://some.pod/resource",
      { read: false, append: false, write: true, control: false },
      "resource"
    );
    aclResource = addMockAclRuleQuads(
      aclResource,
      "https://some.pod/profile#agent-b",
      "https://some.pod/resource",
      { read: true, append: false, write: false, control: false },
      "resource"
    );

    const mockFetch = jest.fn(window.fetch).mockResolvedValue(
      mockResponse(await triplesToTurtle(Array.from(aclResource)), {
        status: 200,
        url: "https://some.pod/resource.acl",
      })
    );

    const resource = getMockDataset(
      "https://some.pod/resource",
      "https://some.pod/resource.acl"
    );
    await expect(
      getAgentAccessAll(resource, {
        fetch: mockFetch,
      })
    ).resolves.toStrictEqual({
      "https://some.pod/profile#agent-a": {
        read: undefined,
        append: true,
        write: true,
        controlRead: undefined,
        controlWrite: undefined,
      },
      "https://some.pod/profile#agent-b": {
        read: true,
        append: undefined,
        write: undefined,
        controlRead: undefined,
        controlWrite: undefined,
      },
    });
  });

  it("returns true for both controlRead and controlWrite if an Agent has control access", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      "https://some.pod/profile#agent",
      "https://some.pod/resource",
      { read: false, append: false, write: false, control: true },
      "resource"
    );

    const mockFetch = jest.fn(window.fetch).mockResolvedValue(
      mockResponse(await triplesToTurtle(Array.from(aclResource)), {
        status: 200,
        url: "https://some.pod/resource.acl",
      })
    );

    const resource = getMockDataset(
      "https://some.pod/resource",
      "https://some.pod/resource.acl"
    );
    const result = getAgentAccessAll(resource, {
      fetch: mockFetch,
    });

    await expect(result).resolves.toStrictEqual({
      "https://some.pod/profile#agent": {
        read: undefined,
        append: undefined,
        write: undefined,
        controlRead: true,
        controlWrite: true,
      },
    });
  });
});

describe("getGroupAccessAll", () => {
  it("uses the default fetcher if none is provided", async () => {
    const mockedFetcher = jest.requireMock("../fetcher.ts") as {
      fetch: jest.Mock<
        ReturnType<typeof window.fetch>,
        [RequestInfo, RequestInit?]
      >;
    };

    const resource = getMockDataset(
      "https://some.pod/resource",
      "https://some.pod/resource.acl"
    );
    await getGroupAccessAll(resource);

    expect(mockedFetcher.fetch.mock.calls[0][0]).toEqual(
      "https://some.pod/resource.acl"
    );
  });

  it("returns null if the advertized ACL isn't accessible", async () => {
    const mockFetch = jest
      .fn(window.fetch)
      // No resource ACL available...
      .mockResolvedValueOnce(
        mockResponse("", {
          status: 404,
          url: "https://some.pod/resource.acl",
        })
      )
      // Link to the fallback ACL...
      .mockResolvedValueOnce(
        mockResponse("", {
          status: 200,
          url: "https://some.pod/",
          headers: {
            Link: '<.acl>; rel="acl"',
          },
        })
      )
      // Get the fallback ACL
      .mockResolvedValueOnce(
        mockResponse("", {
          status: 404,
          url: "https://some.pod/.acl",
        })
      );

    const resource = getMockDataset(
      "https://some.pod/resource",
      "https://some.pod/resource.acl"
    );
    const result = getGroupAccessAll(resource, {
      fetch: mockFetch,
    });

    await expect(result).resolves.toBeNull();
  });

  it("returns null if no ACL is advertised by the resource", async () => {
    const mockFetch = jest.fn(window.fetch).mockResolvedValue(
      mockResponse("ACL not found", {
        status: 404,
        url: "https://some.pod/resource.acl",
      })
    );

    const resource = getMockDataset("https://some.pod/resource");
    const result = getGroupAccessAll(resource, {
      fetch: mockFetch,
    });

    await expect(result).resolves.toBeNull();
  });

  it("calls the underlying getGroupAccessAll", async () => {
    const mockFetch = jest.fn(window.fetch).mockResolvedValue(
      mockResponse("", {
        status: 200,
        url: "https://some.pod/resource.acl",
      })
    );

    const wacModule = jest.requireActual("../acl/group") as {
      getGroupAccessAll: () => Promise<AgentAccess>;
    };
    const getGroupAccessAllWac = jest.spyOn(wacModule, "getGroupAccessAll");

    const resource = getMockDataset(
      "https://some.pod/resource",
      "https://some.pod/resource.acl"
    );
    await getGroupAccessAll(resource, {
      fetch: mockFetch,
    });

    expect(getGroupAccessAllWac).toHaveBeenCalled();
  });

  it("returns an empty list if the ACL defines no access", async () => {
    const mockFetch = jest.fn(window.fetch).mockResolvedValue(
      mockResponse("", {
        status: 200,
        url: "https://some.pod/resource.acl",
      })
    );
    const resource = getMockDataset(
      "https://some.pod/resource",
      "https://some.pod/resource.acl"
    );
    await expect(
      getGroupAccessAll(resource, {
        fetch: mockFetch,
      })
    ).resolves.toStrictEqual({});
  });

  it("returns the access set for all the actors present", async () => {
    let aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      "https://some.pod/groups#group-a",
      "https://some.pod/resource",
      { read: false, append: false, write: true, control: false },
      "resource",
      "https://some.pod/resource.acl#rule-a",
      acl.agentGroup
    );
    aclResource = addMockAclRuleQuads(
      aclResource,
      "https://some.pod/groups#group-b",
      "https://some.pod/resource",
      { read: true, append: false, write: false, control: false },
      "resource",
      "https://some.pod/resource.acl#rule-b",
      acl.agentGroup
    );

    const mockFetch = jest.fn(window.fetch).mockResolvedValue(
      mockResponse(await triplesToTurtle(Array.from(aclResource)), {
        status: 200,
        url: "https://some.pod/resource.acl",
      })
    );

    const resource = getMockDataset(
      "https://some.pod/resource",
      "https://some.pod/resource.acl"
    );
    await expect(
      getGroupAccessAll(resource, {
        fetch: mockFetch,
      })
    ).resolves.toStrictEqual({
      "https://some.pod/groups#group-a": {
        read: undefined,
        append: true,
        write: true,
        controlRead: undefined,
        controlWrite: undefined,
      },
      "https://some.pod/groups#group-b": {
        read: true,
        append: undefined,
        write: undefined,
        controlRead: undefined,
        controlWrite: undefined,
      },
    });
  });

  it("returns true for both controlRead and controlWrite if a Group has control access", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      "https://some.pod/groups#group",
      "https://some.pod/resource",
      { read: false, append: false, write: false, control: true },
      "resource",
      "https://some.pod/resource.acl#rule",
      acl.agentGroup
    );

    const mockFetch = jest.fn(window.fetch).mockResolvedValue(
      mockResponse(await triplesToTurtle(Array.from(aclResource)), {
        status: 200,
        url: "https://some.pod/resource.acl",
      })
    );

    const resource = getMockDataset(
      "https://some.pod/resource",
      "https://some.pod/resource.acl"
    );
    const result = getGroupAccessAll(resource, {
      fetch: mockFetch,
    });

    await expect(result).resolves.toStrictEqual({
      "https://some.pod/groups#group": {
        read: undefined,
        append: undefined,
        write: undefined,
        controlRead: true,
        controlWrite: true,
      },
    });
  });
});

describe("setAgentAccess", () => {
  it("calls the included fetcher by default", async () => {
    const mockedFetcher = jest.requireMock("../fetcher.ts") as {
      fetch: jest.Mock<
        ReturnType<typeof window.fetch>,
        [RequestInfo, RequestInit?]
      >;
    };

    const resource = getMockDataset(
      "https://some.pod/resource",
      "https://some.pod/resource.acl"
    );
    await setAgentResourceAccess(resource, "https://some.pod/profile#agent", {
      read: true,
      append: undefined,
      write: undefined,
      controlRead: undefined,
      controlWrite: undefined,
    });

    expect(mockedFetcher.fetch.mock.calls[0][0]).toEqual(
      "https://some.pod/resource.acl"
    );
  });

  it("returns null if no ACL is accessible", async () => {
    const mockFetch = jest
      .fn(window.fetch)
      // No resource ACL available...
      .mockResolvedValueOnce(
        mockResponse("", {
          status: 404,
          url: "https://some.pod/resource.acl",
        })
      )
      // Link to the fallback ACL...
      .mockResolvedValueOnce(
        mockResponse("", {
          status: 200,
          url: "https://some.pod/",
          headers: {
            Link: '<.acl>; rel="acl"',
          },
        })
      )
      // Get the fallback ACL
      .mockResolvedValueOnce(
        mockResponse("", {
          status: 404,
          url: "https://some.pod/.acl",
        })
      );

    const resource = getMockDataset(
      "https://some.pod/resource",
      "https://some.pod/resource.acl"
    );
    const result = setAgentResourceAccess(
      resource,
      "https://some.pod/profile#agent",
      {
        read: true,
        append: undefined,
        write: undefined,
        controlRead: undefined,
        controlWrite: undefined,
      },
      {
        fetch: mockFetch,
      }
    );

    await expect(result).resolves.toBeNull();
  });

  it("returns null if no ACL is advertised by the target resource", async () => {
    const mockFetch = jest.fn(window.fetch).mockResolvedValue(
      mockResponse("ACL not found", {
        status: 404,
        url: "https://some.pod/resource.acl",
      })
    );

    const resource = getMockDataset("https://some.pod/resource");
    const result = setAgentResourceAccess(
      resource,
      "https://some.pod/profile#agent",
      {
        read: true,
        append: undefined,
        write: undefined,
        controlRead: undefined,
        controlWrite: undefined,
      },
      {
        fetch: mockFetch,
      }
    );

    await expect(result).resolves.toBeNull();
  });

  it("sets read access in the resource ACL if available", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      "https://some.pod/profile#agent",
      "https://some.pod/resource",
      { read: false, append: false, write: false, control: false },
      "resource"
    );

    const mockFetch = jest.fn(window.fetch).mockResolvedValue(
      mockResponse(await triplesToTurtle(Array.from(aclResource)), {
        status: 200,
        url: "https://some.pod/resource.acl",
      })
    );

    const resource = getMockDataset(
      "https://some.pod/resource",
      "https://some.pod/resource.acl"
    );

    const result = await setAgentResourceAccess(
      resource,
      "https://some.pod/profile#agent",
      {
        read: true,
      },
      {
        fetch: mockFetch,
      }
    );

    const newAccess = getAgentResourceAccess(
      internal_getResourceAcl(result!),
      "https://some.pod/profile#agent"
    );

    expect(newAccess).toStrictEqual({
      read: true,
      append: false,
      write: false,
      control: false,
    });
  });

  it("sets append access in the resource ACL if available", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      "https://some.pod/profile#agent",
      "https://some.pod/resource",
      { read: false, append: false, write: false, control: false },
      "resource"
    );

    const mockFetch = jest.fn(window.fetch).mockResolvedValue(
      mockResponse(await triplesToTurtle(Array.from(aclResource)), {
        status: 200,
        url: "https://some.pod/resource.acl",
      })
    );

    const resource = getMockDataset(
      "https://some.pod/resource",
      "https://some.pod/resource.acl"
    );

    const result = await setAgentResourceAccess(
      resource,
      "https://some.pod/profile#agent",
      {
        append: true,
      },
      {
        fetch: mockFetch,
      }
    );

    const newAccess = getAgentResourceAccess(
      internal_getResourceAcl(result!),
      "https://some.pod/profile#agent"
    );

    expect(newAccess).toStrictEqual({
      read: false,
      append: true,
      write: false,
      control: false,
    });
  });

  it("sets write access in the resource ACL if available", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      "https://some.pod/profile#agent",
      "https://some.pod/resource",
      { read: false, append: false, write: false, control: false },
      "resource"
    );

    const mockFetch = jest.fn(window.fetch).mockResolvedValue(
      mockResponse(await triplesToTurtle(Array.from(aclResource)), {
        status: 200,
        url: "https://some.pod/resource.acl",
      })
    );

    const resource = getMockDataset(
      "https://some.pod/resource",
      "https://some.pod/resource.acl"
    );

    const result = await setAgentResourceAccess(
      resource,
      "https://some.pod/profile#agent",
      {
        write: true,
      },
      {
        fetch: mockFetch,
      }
    );

    const newAccess = getAgentResourceAccess(
      internal_getResourceAcl(result!),
      "https://some.pod/profile#agent"
    );

    expect(newAccess).toStrictEqual({
      read: false,
      append: true,
      write: true,
      control: false,
    });
  });

  it("sets control access in the resource ACL if available", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      "https://some.pod/profile#agent",
      "https://some.pod/resource",
      { read: false, append: false, write: false, control: false },
      "resource"
    );

    const mockFetch = jest.fn(window.fetch).mockResolvedValue(
      mockResponse(await triplesToTurtle(Array.from(aclResource)), {
        status: 200,
        url: "https://some.pod/resource.acl",
      })
    );

    const resource = getMockDataset(
      "https://some.pod/resource",
      "https://some.pod/resource.acl"
    );

    const result = await setAgentResourceAccess(
      resource,
      "https://some.pod/profile#agent",
      {
        controlRead: true,
        controlWrite: true,
      },
      {
        fetch: mockFetch,
      }
    );

    const newAccess = getAgentResourceAccess(
      internal_getResourceAcl(result!),
      "https://some.pod/profile#agent"
    );

    expect(newAccess).toStrictEqual({
      read: false,
      append: false,
      write: false,
      control: true,
    });
  });

  it("preserves previously existing access for the resource if undefined in the access being set", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      "https://some.pod/profile#agent",
      "https://some.pod/resource",
      // Note that append access is set
      { read: false, append: true, write: false, control: false },
      "resource"
    );

    const mockFetch = jest.fn(window.fetch).mockResolvedValue(
      mockResponse(await triplesToTurtle(Array.from(aclResource)), {
        status: 200,
        url: "https://some.pod/resource.acl",
      })
    );

    const resource = getMockDataset(
      "https://some.pod/resource",
      "https://some.pod/resource.acl"
    );

    const result = await setAgentResourceAccess(
      resource,
      "https://some.pod/profile#agent",
      {
        read: true,
      },
      {
        fetch: mockFetch,
      }
    );

    const newAccess = getAgentResourceAccess(
      internal_getResourceAcl(result!),
      "https://some.pod/profile#agent"
    );

    expect(newAccess).toStrictEqual({
      read: true,
      append: true,
      write: false,
      control: false,
    });
  });

  it("removes access previously granted if the new access is set to false", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      "https://some.pod/profile#agent",
      "https://some.pod/resource",
      { read: false, append: true, write: false, control: false },
      "resource"
    );

    const mockFetch = jest.fn(window.fetch).mockResolvedValue(
      mockResponse(await triplesToTurtle(Array.from(aclResource)), {
        status: 200,
        url: "https://some.pod/resource.acl",
      })
    );

    const resource = getMockDataset(
      "https://some.pod/resource",
      "https://some.pod/resource.acl"
    );

    const result = await setAgentResourceAccess(
      resource,
      "https://some.pod/profile#agent",
      {
        append: false,
      },
      {
        fetch: mockFetch,
      }
    );

    const newAccess = getAgentResourceAccess(
      internal_getResourceAcl(result!),
      "https://some.pod/profile#agent"
    );

    expect(newAccess).toStrictEqual({
      read: false,
      append: false,
      write: false,
      control: false,
    });
  });

  it("overwrites all previously existing access for the resource if no mode is left undefined in the access being set", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      "https://some.pod/profile#agent",
      "https://some.pod/resource",
      // Note that append access is set
      { read: false, append: false, write: false, control: false },
      "resource"
    );

    const mockFetch = jest.fn(window.fetch).mockResolvedValue(
      mockResponse(await triplesToTurtle(Array.from(aclResource)), {
        status: 200,
        url: "https://some.pod/resource.acl",
      })
    );

    const resource = getMockDataset(
      "https://some.pod/resource",
      "https://some.pod/resource.acl"
    );

    const result = await setAgentResourceAccess(
      resource,
      "https://some.pod/profile#agent",
      {
        read: true,
        append: true,
        write: true,
        controlRead: true,
        controlWrite: true,
      },
      {
        fetch: mockFetch,
      }
    );

    const newAccess = getAgentResourceAccess(
      internal_getResourceAcl(result!),
      "https://some.pod/profile#agent"
    );

    expect(newAccess).toStrictEqual({
      read: true,
      append: true,
      write: true,
      control: true,
    });
  });

  it("copies the fallback ACL if no resource ACL is available, and sets intended access in the newly created copy", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/.acl"),
      "https://some.pod/profile#agent",
      "https://some.pod/",
      { read: false, append: false, write: false, control: false },
      "default"
    );

    const mockFetch = jest
      .fn(window.fetch)
      // No resource ACL available...
      .mockResolvedValueOnce(
        mockResponse("", {
          status: 404,
          url: "https://some.pod/resource.acl",
        })
      )
      // Link to the fallback ACL...
      .mockResolvedValueOnce(
        mockResponse("", {
          status: 200,
          url: "https://some.pod/",
          headers: {
            Link: '<.acl>; rel="acl"',
          },
        })
      )
      // Get the fallback ACL
      .mockResolvedValueOnce(
        mockResponse(await triplesToTurtle(Array.from(aclResource)), {
          status: 200,
          url: "https://some.pod/.acl",
        })
      )
      // Save the ACL
      .mockResolvedValueOnce(
        mockResponse("", {
          status: 201,
          url: "https://some.pod/.acl",
        })
      );

    const resource = getMockDataset(
      "https://some.pod/resource",
      "https://some.pod/resource.acl"
    );

    const result = await setAgentResourceAccess(
      resource,
      "https://some.pod/profile#agent",
      {
        append: true,
      },
      {
        fetch: mockFetch,
      }
    );

    const newAccess = getAgentResourceAccess(
      internal_getResourceAcl(result!),
      "https://some.pod/profile#agent"
    );

    expect(newAccess).toStrictEqual({
      read: false,
      append: true,
      write: false,
      control: false,
    });
  });

  it("ignores the fallback ACL if the resource ACL is available", async () => {
    const fallbackAclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/.acl"),
      "https://some.pod/profile#another-agent",
      "https://some.pod/",
      { read: true, append: false, write: false, control: false },
      "default"
    );

    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      "https://some.pod/profile#agent",
      "https://some.pod/resource",
      { read: false, append: true, write: false, control: false },
      "resource"
    );

    const mockFetch = jest
      .fn(window.fetch)
      // The resource ACL is available...
      .mockResolvedValueOnce(
        mockResponse(await triplesToTurtle(Array.from(aclResource)), {
          status: 200,
          url: "https://some.pod/resource.acl",
        })
      )
      // Link to the fallback ACL...
      .mockResolvedValueOnce(
        mockResponse("", {
          status: 200,
          url: "https://some.pod/",
          headers: {
            Link: '<.acl>; rel="acl"',
          },
        })
      )
      // Get the fallback ACL
      .mockResolvedValueOnce(
        mockResponse(await triplesToTurtle(Array.from(fallbackAclResource)), {
          status: 200,
          url: "https://some.pod/.acl",
        })
      );

    const resource = getMockDataset(
      "https://some.pod/resource",
      "https://some.pod/resource.acl"
    );
    const result = await setAgentResourceAccess(
      resource,
      "https://some.pod/profile#agent",
      {
        append: true,
      },
      {
        fetch: mockFetch,
      }
    );

    // Here, we check that the agent set in the fallback ACL isn't present in
    // the resource ACL
    const newAccess = getAgentResourceAccess(
      internal_getResourceAcl(result!),
      "https://some.pod/profile#another-agent"
    );

    expect(newAccess).toStrictEqual({
      read: false,
      append: false,
      write: false,
      control: false,
    });
  });

  it("throws if the access being set can't be expressed in WAC", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      "https://some.pod/profile#agent",
      "https://some.pod/resource",
      { read: false, append: false, write: false, control: false },
      "resource"
    );

    const mockFetch = jest.fn(window.fetch).mockResolvedValue(
      mockResponse(await triplesToTurtle(Array.from(aclResource)), {
        status: 200,
        url: "https://some.pod/resource.acl",
      })
    );

    const resource = getMockDataset(
      "https://some.pod/resource",
      "https://some.pod/resource.acl"
    );

    await expect(
      setAgentResourceAccess(
        resource,
        "https://some.pod/profile#agent",
        ({
          controlRead: true,
          controlWrite: undefined,
        } as unknown) as WacAccess,
        {
          fetch: mockFetch,
        }
      )
    ).rejects.toThrow(
      "For Pods using Web Access Control, controlRead and controlWrite must be equal."
    );
  });

  it("returns null if the ACL cannot be written back", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      "https://some.pod/profile#agent",
      "https://some.pod/resource",
      { read: false, append: false, write: false, control: false },
      "resource"
    );

    const mockFetch = jest
      .fn(window.fetch)
      // The resource ACL is available...
      .mockResolvedValueOnce(
        mockResponse(await triplesToTurtle(Array.from(aclResource)), {
          status: 200,
          url: "https://some.pod/resource.acl",
        })
      )
      // Cannot save the ACL
      .mockResolvedValueOnce(
        mockResponse("Not authorized", {
          status: 403,
          url: "https://some.pod/.acl",
        })
      );

    const resource = getMockDataset(
      "https://some.pod/resource",
      "https://some.pod/resource.acl"
    );

    const result = await setAgentResourceAccess(
      resource,
      "https://some.pod/profile#agent",
      {
        read: true,
        append: undefined,
        write: undefined,
        controlRead: undefined,
        controlWrite: undefined,
      },
      {
        fetch: mockFetch,
      }
    );
    expect(result).toBeNull();
  });

  it("calls the underlying WAC API functions", async () => {
    const mockFetch = jest.fn(window.fetch).mockResolvedValue(
      mockResponse("", {
        status: 200,
        url: "https://some.pod/resource.acl",
      })
    );

    const wacModule = jest.requireActual("../acl/agent") as {
      setAgentResourceAccess: () => Promise<AgentAccess>;
    };
    const aclModule = jest.requireActual("../acl/acl") as {
      saveAclFor: () => Promise<AclDataset>;
    };
    const setAgentResourceAccessWac = jest.spyOn(
      wacModule,
      "setAgentResourceAccess"
    );
    const saveAclForWac = jest.spyOn(aclModule, "saveAclFor");

    const resource = getMockDataset(
      "https://some.pod/resource",
      "https://some.pod/resource.acl"
    );
    await setAgentResourceAccess(
      resource,
      "https://some.pod/profile#agent",
      {
        read: undefined,
        append: true,
        write: undefined,
        controlRead: undefined,
        controlWrite: undefined,
      },
      {
        fetch: mockFetch,
      }
    );
    expect(setAgentResourceAccessWac).toHaveBeenCalled();
    expect(saveAclForWac).toHaveBeenCalled();
  });
});
