export const WIKI260927_VAULT_ID = "deskrpg-wiki";
export const WIKI260927_SERVER_ROOT = "/opt/data/deskrpg/wiki260927";

export type WikiMeetingSource = {
  title: string;
  locator: string;
  summary: string;
};

export type WikiMeetingContext = {
  sourceCommit: string;
  internalSources: WikiMeetingSource[];
  externalSources: WikiMeetingSource[];
  evidenceMarkdown: string;
};

type Identity = { vaultId: string; vaultRoot: string };

export type PrepareWikiMeetingContextInput = Identity & {
  topic: string;
  moderator: string;
  runResearch: (prompt: string) => Promise<string>;
};

export type QueueWikiMeetingMinutesInput = Identity & {
  meetingId: string;
  minutesId: string;
  topic: string;
  moderator: string;
  participants: string[];
  transcript: string;
  keyTopics: string[];
  conclusions: string | null;
  sourceCommit: string;
  internalSources: WikiMeetingSource[];
  externalSources: WikiMeetingSource[];
  runQueue: (prompt: string) => Promise<string>;
};

export type WikiMeetingQueueResult =
  | { ok: true; proposalId: string; status: "pending" }
  | {
      ok: false;
      code:
        | "wrong_vault_identity"
        | "invalid_meeting_artifact"
        | "queue_failed"
        | "invalid_queue_response";
      detail?: string;
    };

function assertIdentity(input: Identity): void {
  if (input.vaultId !== WIKI260927_VAULT_ID || input.vaultRoot !== WIKI260927_SERVER_ROOT) {
    throw new Error("wrong_vault_identity");
  }
}

function parseObject(value: string, errorCode: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error(errorCode);
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof Error && error.message === errorCode) throw error;
    throw new Error(errorCode);
  }
}

function readSources(value: unknown, kind: "internal" | "external"): WikiMeetingSource[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${kind}_research_missing`);
  if (value.length > 5) throw new Error(`${kind}_source_limit_exceeded`);

  return value.map((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new Error(`${kind}_source_invalid`);
    }
    const { title, locator, summary } = item as Record<string, unknown>;
    if (
      typeof title !== "string" ||
      !title.trim() ||
      typeof locator !== "string" ||
      !locator.trim() ||
      typeof summary !== "string" ||
      !summary.trim()
    ) {
      throw new Error(`${kind}_source_invalid`);
    }
    if (kind === "internal") {
      if (locator.startsWith("/") || locator.split("/").includes("..")) {
        throw new Error("internal_source_outside_vault");
      }
    } else {
      let url: URL;
      try {
        url = new URL(locator);
      } catch {
        throw new Error("external_source_invalid");
      }
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        throw new Error("external_source_invalid");
      }
    }
    return { title: title.trim(), locator: locator.trim(), summary: summary.trim() };
  });
}

function formatSources(sources: WikiMeetingSource[]): string {
  return sources
    .map((source, index) => `${index + 1}. [${source.title}](${source.locator}) — ${source.summary}`)
    .join("\n");
}

function formatEvidence(input: {
  topic: string;
  moderator: string;
  sourceCommit: string;
  internalSources: WikiMeetingSource[];
  externalSources: WikiMeetingSource[];
}): string {
  return [
    "## Wiki260927 공통 회의 근거",
    `- 회의 주제: ${input.topic}`,
    `- 회의 주재자: ${input.moderator}`,
    `- 볼트 기준 커밋: ${input.sourceCommit}`,
    "",
    "### 내부 자료",
    formatSources(input.internalSources),
    "",
    "### 외부 자료",
    formatSources(input.externalSources),
    "",
    "모든 참석자는 위의 동일한 근거 묶음을 사용하고, 근거와 해석을 구분한다.",
  ].join("\n");
}

export async function prepareWikiMeetingContext(
  input: PrepareWikiMeetingContextInput,
): Promise<WikiMeetingContext> {
  assertIdentity(input);
  const prompt = [
    "wiki-query 스킬을 사용해 지정된 Wiki260927 내부 자료와 외부 웹을 모두 조사하라.",
    `vault_id: ${input.vaultId}`,
    `vault_root: ${input.vaultRoot}`,
    `회의 주제: ${input.topic}`,
    `회의 주재자: ${input.moderator}`,
    "내부 자료와 외부 자료를 각각 1~5개로 제한하고, 현재 Git HEAD의 40자리 커밋을 포함하라.",
    "다른 볼트는 읽거나 참조하지 말라.",
    "설명 없이 다음 JSON만 반환하라:",
    '{"vault_id":"...","vault_root":"...","source_commit":"40 hex","internal_sources":[{"title":"...","locator":"vault-relative path","summary":"..."}],"external_sources":[{"title":"...","locator":"https://...","summary":"..."}]}',
  ].join("\n");

  const result = parseObject(await input.runResearch(prompt), "invalid_research_response");
  if (result.vault_id !== input.vaultId || result.vault_root !== input.vaultRoot) {
    throw new Error("wrong_vault_identity");
  }
  if (typeof result.source_commit !== "string" || !/^[0-9a-f]{40}$/i.test(result.source_commit)) {
    throw new Error("invalid_source_commit");
  }
  const internalSources = readSources(result.internal_sources, "internal");
  const externalSources = readSources(result.external_sources, "external");
  const context = {
    sourceCommit: result.source_commit,
    internalSources,
    externalSources,
    evidenceMarkdown: "",
  };
  context.evidenceMarkdown = formatEvidence({
    topic: input.topic,
    moderator: input.moderator,
    ...context,
  });
  return context;
}

export async function queueWikiMeetingMinutes(
  input: QueueWikiMeetingMinutesInput,
): Promise<WikiMeetingQueueResult> {
  try {
    assertIdentity(input);
  } catch {
    return { ok: false, code: "wrong_vault_identity" };
  }
  if (
    !input.meetingId ||
    !input.minutesId ||
    !input.topic.trim() ||
    !input.moderator.trim() ||
    !input.transcript.trim() ||
    !/^[0-9a-f]{40}$/i.test(input.sourceCommit) ||
    input.internalSources.length < 1 ||
    input.internalSources.length > 5 ||
    input.externalSources.length < 1 ||
    input.externalSources.length > 5
  ) {
    return { ok: false, code: "invalid_meeting_artifact" };
  }

  const markdown = [
    "---",
    `meeting_id: ${JSON.stringify(input.meetingId)}`,
    `minutes_id: ${JSON.stringify(input.minutesId)}`,
    `moderator: ${JSON.stringify(input.moderator)}`,
    `source_commit: ${JSON.stringify(input.sourceCommit)}`,
    "---",
    "",
    `# 회의록: ${input.topic}`,
    "",
    `- 회의 주재자: ${input.moderator}`,
    `- 참석자: ${input.participants.join(", ")}`,
    "",
    "## 내부 자료",
    formatSources(input.internalSources),
    "",
    "## 외부 자료",
    formatSources(input.externalSources),
    "",
    "## 핵심 주제",
    input.keyTopics.length ? input.keyTopics.map((topic) => `- ${topic}`).join("\n") : "- 없음",
    "",
    "## 결론",
    input.conclusions || "결론 없음",
    "",
    "## 전체 회의 전문",
    input.transcript,
  ].join("\n");

  try {
    const raw = await input.runQueue(
      [
        "wiki-meeting 스킬을 사용해 아래 회의록을 Wiki260927 보낼함에 pending 제안으로 저장하라.",
        `vault_id: ${input.vaultId}`,
        `vault_root: ${input.vaultRoot}`,
        "다른 볼트를 읽거나 참조하거나 쓰지 말라. 실제 wiki/에는 직접 쓰지 말라.",
        "저장 후 설명 없이 다음 JSON만 반환하라:",
        `{"proposal_id":"...","status":"pending","meeting_id":${JSON.stringify(input.meetingId)}}`,
        "",
        markdown,
      ].join("\n"),
    );
    const response = parseObject(raw, "invalid_queue_response");
    if (
      typeof response.proposal_id !== "string" ||
      !response.proposal_id.trim() ||
      response.status !== "pending" ||
      response.meeting_id !== input.meetingId
    ) {
      return { ok: false, code: "invalid_queue_response" };
    }
    return { ok: true, proposalId: response.proposal_id, status: "pending" };
  } catch (error) {
    if (error instanceof Error && error.message === "invalid_queue_response") {
      return { ok: false, code: "invalid_queue_response" };
    }
    return {
      ok: false,
      code: "queue_failed",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}
