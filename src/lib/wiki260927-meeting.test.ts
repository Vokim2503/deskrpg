import assert from "node:assert/strict";
import test from "node:test";

import {
  WIKI260927_SERVER_ROOT,
  WIKI260927_VAULT_ID,
  prepareWikiMeetingContext,
  queueWikiMeetingMinutes,
} from "./wiki260927-meeting";

const sha = "a".repeat(40);

function researchResult(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    vault_id: WIKI260927_VAULT_ID,
    vault_root: WIKI260927_SERVER_ROOT,
    source_commit: sha,
    internal_sources: [
      { title: "운영 안내", locator: "wiki/Wiki260927 운영 안내.md", summary: "볼트 규칙" },
    ],
    external_sources: [
      { title: "Primary source", locator: "https://example.com/source", summary: "외부 근거" },
    ],
    ...overrides,
  });
}

test("wrong Wiki260927 identity is rejected before research runs", async () => {
  let calls = 0;
  await assert.rejects(
    prepareWikiMeetingContext({
      topic: "주제",
      moderator: "Vokim",
      vaultId: "another-vault",
      vaultRoot: WIKI260927_SERVER_ROOT,
      runResearch: async () => {
        calls++;
        return researchResult();
      },
    }),
    /wrong_vault_identity/,
  );
  assert.equal(calls, 0);
});

for (const [name, overrides, error] of [
  ["internal research", { internal_sources: [] }, "internal_research_missing"],
  ["external research", { external_sources: [] }, "external_research_missing"],
  [
    "more than five internal sources",
    {
      internal_sources: Array.from({ length: 6 }, (_, i) => ({
        title: `내부 ${i}`,
        locator: `wiki/${i}.md`,
        summary: "근거",
      })),
    },
    "internal_source_limit_exceeded",
  ],
  [
    "more than five external sources",
    {
      external_sources: Array.from({ length: 6 }, (_, i) => ({
        title: `외부 ${i}`,
        locator: `https://example.com/${i}`,
        summary: "근거",
      })),
    },
    "external_source_limit_exceeded",
  ],
] as const) {
  test(`${name} fails closed`, async () => {
    await assert.rejects(
      prepareWikiMeetingContext({
        topic: "주제",
        moderator: "Vokim",
        vaultId: WIKI260927_VAULT_ID,
        vaultRoot: WIKI260927_SERVER_ROOT,
        runResearch: async () => researchResult(overrides),
      }),
      new RegExp(error),
    );
  });
}

test("one bounded evidence packet preserves the initiating moderator", async () => {
  let prompt = "";
  const context = await prepareWikiMeetingContext({
    topic: "AI와 노동",
    moderator: "Vokim",
    vaultId: WIKI260927_VAULT_ID,
    vaultRoot: WIKI260927_SERVER_ROOT,
    runResearch: async (value) => {
      prompt = value;
      return researchResult();
    },
  });
  assert.match(prompt, /Vokim/);
  assert.doesNotMatch(prompt, /Creator/);
  assert.equal(context.sourceCommit, sha);
  assert.match(context.evidenceMarkdown, /회의 주재자: Vokim/);
  assert.match(context.evidenceMarkdown, /내부 자료/);
  assert.match(context.evidenceMarkdown, /외부 자료/);
});

test("meeting minutes are queued only as a pending Wiki260927 proposal", async () => {
  let prompt = "";
  const result = await queueWikiMeetingMinutes({
    vaultId: WIKI260927_VAULT_ID,
    vaultRoot: WIKI260927_SERVER_ROOT,
    meetingId: "meet-1",
    minutesId: "minutes-1",
    topic: "AI와 노동",
    moderator: "Vokim",
    participants: ["Vokim", "Searcher", "Writer"],
    transcript: "회의 전문",
    keyTopics: ["노동"],
    conclusions: "추가 검토",
    sourceCommit: sha,
    internalSources: [
      { title: "내부", locator: "wiki/a.md", summary: "내부 요약" },
    ],
    externalSources: [
      { title: "외부", locator: "https://example.com", summary: "외부 요약" },
    ],
    runQueue: async (value) => {
      prompt = value;
      return JSON.stringify({ proposal_id: "meeting-meet-1", status: "pending", meeting_id: "meet-1" });
    },
  });
  assert.deepEqual(result, { ok: true, proposalId: "meeting-meet-1", status: "pending" });
  assert.match(prompt, /wiki-meeting/);
  assert.match(prompt, /회의 주재자: Vokim/);
  assert.match(prompt, /회의 전문/);
  assert.doesNotMatch(prompt, /Creator/);
});

test("queue refuses another vault without calling Hermes", async () => {
  let calls = 0;
  const result = await queueWikiMeetingMinutes({
    vaultId: WIKI260927_VAULT_ID,
    vaultRoot: "/opt/data/some-other-vault",
    meetingId: "meet-1",
    minutesId: "minutes-1",
    topic: "topic",
    moderator: "Vokim",
    participants: [],
    transcript: "text",
    keyTopics: [],
    conclusions: null,
    sourceCommit: sha,
    internalSources: [],
    externalSources: [],
    runQueue: async () => {
      calls++;
      return "{}";
    },
  });
  assert.deepEqual(result, { ok: false, code: "wrong_vault_identity" });
  assert.equal(calls, 0);
});
