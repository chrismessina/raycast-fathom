import type {
  MeetingFilter,
  Paginated,
  Meeting,
  Recording,
  Summary,
  Transcript,
  Team,
  TeamMember,
} from "../types/Types";
import { getFathomClient, getApiKey } from "./client";
import { isNumber, toStringOrUndefined } from "../utils/typeGuards";
import { convertSDKMeeting, convertSDKTeam, convertSDKTeamMember, mapRecordingFromMeeting } from "../utils/converters";
import { formatTranscriptToMarkdown } from "../utils/formatting";
import { parseTimestamp } from "../utils/dates";

const BASE = "https://api.fathom.ai/external/v1";

// Fetch helpers
async function authGet<T>(path: string): Promise<T> {
  const apiKey = getApiKey();
  if (!apiKey || apiKey.trim() === "") {
    throw new Error("Fathom API Key is not set. Please configure it in Extension Preferences.");
  }

  const res = await fetch(`${BASE}${path}`, {
    method: "GET",
    headers: {
      "X-Api-Key": apiKey,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    if (res.status === 401) {
      throw new Error("Invalid API Key. Please check your Fathom API Key in Extension Preferences.");
    }
    if (res.status === 429) {
      throw new Error("Rate limit exceeded. Please wait a moment and try again.");
    }
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as unknown;
  return data as T;
}

// API functions
export async function listMeetings(filter: MeetingFilter): Promise<Paginated<Meeting>> {
  try {
    const client = getFathomClient();

    const result = await client.listMeetings({
      cursor: filter.cursor,
      calendarInvitees: filter.calendarInvitees,
      calendarInviteesDomains: filter.calendarInviteesDomains,
    });

    const items: Meeting[] = [];
    let nextCursor: string | undefined = undefined;

    for await (const response of result) {
      const meetingListResponse = response.result;
      items.push(...meetingListResponse.items.map(convertSDKMeeting));
      nextCursor = meetingListResponse.nextCursor || undefined;
      break; // Only get first page
    }

    return { items, nextCursor };
  } catch (error) {
    // Fallback to direct HTTP if SDK validation fails
    // This is expected with SDK v0.0.30 - the API returns valid data but SDK validation is strict
    if (error && typeof error === "object" && "statusCode" in error && error.statusCode === 200) {
      // Silent fallback - API returned 200, just SDK validation failed
      return await listMeetingsHTTP(filter);
    }
    // For other errors, log and fallback
    console.warn("Fathom SDK error, using HTTP fallback:", error instanceof Error ? error.message : String(error));
    return await listMeetingsHTTP(filter);
  }
}

// HTTP fallback for when SDK validation fails
async function listMeetingsHTTP(filter: MeetingFilter): Promise<Paginated<Meeting>> {
  const params: string[] = [];
  if (filter.cursor) params.push(`cursor=${encodeURIComponent(filter.cursor)}`);
  if (filter.calendarInvitees?.length) {
    filter.calendarInvitees.forEach((email) => params.push(`calendar_invitees[]=${encodeURIComponent(email)}`));
  }
  if (filter.calendarInviteesDomains?.length) {
    filter.calendarInviteesDomains.forEach((domain) =>
      params.push(`calendar_invitees_domains[]=${encodeURIComponent(domain)}`),
    );
  }
  if (filter.createdAfter) params.push(`created_after=${encodeURIComponent(filter.createdAfter)}`);
  if (filter.createdBefore) params.push(`created_before=${encodeURIComponent(filter.createdBefore)}`);

  const queryString = params.length > 0 ? `?${params.join("&")}` : "";
  const resp = await authGet<unknown>(`/meetings${queryString}`);

  if (typeof resp !== "object" || resp === null) {
    return { items: [], nextCursor: undefined };
  }

  const r = resp as Record<string, unknown>;
  const itemsRaw = Array.isArray(r["items"]) ? (r["items"] as unknown[]) : [];
  const items = itemsRaw.map(mapMeetingFromHTTP).filter((m): m is Meeting => Boolean(m));
  const nextCursor = toStringOrUndefined(r["next_cursor"]) || undefined;

  return { items, nextCursor };
}

// Map raw HTTP response to Meeting type
function mapMeetingFromHTTP(raw: unknown): Meeting | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;

  const recordingId =
    toStringOrUndefined(r["recording_id"]) ?? (isNumber(r["recording_id"]) ? String(r["recording_id"]) : undefined);
  if (!recordingId) return undefined;

  const title = toStringOrUndefined(r["title"]) ?? "Untitled";
  const meetingTitle = toStringOrUndefined(r["meeting_title"]);
  const url = toStringOrUndefined(r["url"]) ?? "";
  const shareUrl = toStringOrUndefined(r["share_url"]);
  const startTimeISO = toStringOrUndefined(r["recording_start_time"]) ?? "";
  if (!startTimeISO) return undefined;

  const createdAt = toStringOrUndefined(r["created_at"]);
  const scheduledStartTime = toStringOrUndefined(r["scheduled_start_time"]);
  const scheduledEndTime = toStringOrUndefined(r["scheduled_end_time"]);
  const recordingEndTime = toStringOrUndefined(r["recording_end_time"]);

  // Calculate duration if we have both times
  let durationSeconds: number | undefined;
  if (recordingEndTime && startTimeISO) {
    const start = new Date(startTimeISO).getTime();
    const end = new Date(recordingEndTime).getTime();
    durationSeconds = Math.floor((end - start) / 1000);
  }

  const calendarInviteesDomainType = toStringOrUndefined(r["calendar_invitees_domains_type"]) as
    | "all"
    | "only_internal"
    | "one_or_more_external"
    | undefined;
  const isExternal = calendarInviteesDomainType === "one_or_more_external";
  const transcriptLanguage = toStringOrUndefined(r["transcript_language"]);

  // Parse calendar invitees
  const calendarInviteesRaw = Array.isArray(r["calendar_invitees"]) ? r["calendar_invitees"] : [];
  const calendarInvitees = calendarInviteesRaw
    .map((inv: unknown) => {
      if (typeof inv === "object" && inv !== null) {
        return toStringOrUndefined((inv as Record<string, unknown>)["email"]);
      }
      return undefined;
    })
    .filter((email): email is string => Boolean(email));

  const calendarInviteesDomains = Array.from(
    new Set(calendarInvitees.map((email) => email.split("@")[1]).filter(Boolean)),
  );

  // Parse recorded_by
  const recordedBy = r["recorded_by"];
  let recordedByUserId: string | undefined;
  let recordedByName: string | undefined;
  let recordedByTeam: string | null | undefined;

  if (typeof recordedBy === "object" && recordedBy !== null) {
    const rb = recordedBy as Record<string, unknown>;
    recordedByUserId = toStringOrUndefined(rb["email"]);
    recordedByName = toStringOrUndefined(rb["name"]);
    recordedByTeam = toStringOrUndefined(rb["team"]) ?? null;
  }

  return {
    id: recordingId,
    recordingId,
    title,
    meetingTitle,
    url,
    shareUrl,
    createdAt,
    scheduledStartTime,
    scheduledEndTime,
    startTimeISO,
    recordingEndTime,
    durationSeconds,
    calendarInviteesDomainType,
    isExternal,
    transcriptLanguage,
    calendarInvitees,
    calendarInviteesDomains,
    recordedByUserId,
    recordedByName,
    recordedByTeam,
    teamId: undefined,
    teamName: null,
  };
}

export async function listRecentRecordings(
  args: { pageSize?: number; cursor?: string } = {},
): Promise<Paginated<Recording>> {
  // Fallback: derive recordings from meetings until a dedicated recordings list endpoint is available.
  const page = await listMeetings({ cursor: args.cursor });
  return {
    items: page.items.map(mapRecordingFromMeeting),
    nextCursor: page.nextCursor,
  };
}

export async function getMeetingSummary(recordingId: string): Promise<Summary> {
  const resp = await authGet<unknown>(`/recordings/${encodeURIComponent(recordingId)}/summary`);

  if (typeof resp !== "object" || resp === null) {
    return { text: "", templateName: null };
  }

  const r = resp as Record<string, unknown>;

  // API returns: { summary: { template_name: "general", markdown_formatted: "..." } }
  if (typeof r["summary"] === "object" && r["summary"] !== null) {
    const summary = r["summary"] as Record<string, unknown>;
    const text = toStringOrUndefined(summary["markdown_formatted"]) || "";
    const templateName = toStringOrUndefined(summary["template_name"]);
    return { text, templateName };
  }

  // Fallback for other response formats
  const text = toStringOrUndefined(r["markdown_formatted"]) || toStringOrUndefined(r["text"]) || "";
  return { text, templateName: null };
}

export async function getMeetingTranscript(recordingId: string): Promise<Transcript> {
  const resp = await authGet<unknown>(`/recordings/${encodeURIComponent(recordingId)}/transcript`);

  if (typeof resp !== "object" || resp === null) {
    return { text: "" };
  }

  const r = resp as Record<string, unknown>;

  // API returns: { transcript: [ { speaker: {...}, text: "...", timestamp: "00:05:32" }, ... ] }
  const transcriptArray = Array.isArray(r["transcript"]) ? (r["transcript"] as unknown[]) : [];

  const segments = transcriptArray
    .map((item) => {
      if (typeof item !== "object" || item === null) return undefined;
      const t = item as Record<string, unknown>;

      // Parse speaker
      let speaker: string | undefined;
      if (typeof t["speaker"] === "object" && t["speaker"] !== null) {
        const speakerObj = t["speaker"] as Record<string, unknown>;
        speaker = toStringOrUndefined(speakerObj["display_name"]);
      } else {
        speaker = toStringOrUndefined(t["speaker"]);
      }

      // Parse timestamp (HH:MM:SS format)
      const timestamp = toStringOrUndefined(t["timestamp"]) || "00:00:00";
      const startSeconds = parseTimestamp(timestamp);

      const text = toStringOrUndefined(t["text"]) || "";

      return {
        startSeconds,
        endSeconds: startSeconds, // We don't have end time, use start
        speaker,
        text,
        timestamp,
      };
    })
    .filter((s): s is NonNullable<typeof s> => Boolean(s));

  // Build full text from segments using formatter
  const fullText = formatTranscriptToMarkdown(segments);

  return { text: fullText, segments };
}

export async function listTeams(
  args: { pageSize?: number; cursor?: string; query?: string } = {},
): Promise<Paginated<Team>> {
  try {
    const client = getFathomClient();

    const response = await client.listTeams({
      cursor: args.cursor,
    });

    const items = response.items.map(convertSDKTeam);
    const nextCursor = response.nextCursor || undefined;

    return { items, nextCursor };
  } catch (error) {
    // Fallback to direct HTTP if SDK validation fails
    if (error && typeof error === "object" && "statusCode" in error && error.statusCode === 200) {
      return await listTeamsHTTP(args);
    }
    console.warn("Fathom SDK error, using HTTP fallback:", error instanceof Error ? error.message : String(error));
    return await listTeamsHTTP(args);
  }
}

// HTTP fallback for listTeams
async function listTeamsHTTP(
  args: { pageSize?: number; cursor?: string; query?: string } = {},
): Promise<Paginated<Team>> {
  const params: string[] = [];
  if (args.cursor) params.push(`cursor=${encodeURIComponent(args.cursor)}`);

  const queryString = params.length > 0 ? `?${params.join("&")}` : "";
  const resp = await authGet<unknown>(`/teams${queryString}`);

  if (typeof resp !== "object" || resp === null) {
    return { items: [], nextCursor: undefined };
  }

  const r = resp as Record<string, unknown>;
  const itemsRaw = Array.isArray(r["items"]) ? (r["items"] as unknown[]) : [];
  const items = itemsRaw.map(mapTeamFromHTTP).filter((t): t is Team => Boolean(t));
  const nextCursor = toStringOrUndefined(r["next_cursor"]) || undefined;

  return { items, nextCursor };
}

// Map raw HTTP response to Team type
function mapTeamFromHTTP(raw: unknown): Team | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;

  const name = toStringOrUndefined(r["name"]);
  if (!name) return undefined;

  const createdAt = toStringOrUndefined(r["created_at"]);

  return {
    id: name, // Use name as ID since API doesn't provide separate ID
    name,
    createdAt,
    memberCount: undefined,
  };
}

export async function listTeamMembers(
  teamId?: string,
  args: { pageSize?: number; cursor?: string; query?: string } = {},
): Promise<Paginated<TeamMember>> {
  try {
    const client = getFathomClient();

    const response = await client.listTeamMembers({
      cursor: args.cursor,
      team: teamId,
    });

    const items = response.items.map((tm) => convertSDKTeamMember(tm, teamId));
    const nextCursor = response.nextCursor || undefined;

    return { items, nextCursor };
  } catch (error) {
    // Fallback to direct HTTP if SDK validation fails
    if (error && typeof error === "object" && "statusCode" in error && error.statusCode === 200) {
      return await listTeamMembersHTTP(teamId, args);
    }
    console.warn("Fathom SDK error, using HTTP fallback:", error instanceof Error ? error.message : String(error));
    return await listTeamMembersHTTP(teamId, args);
  }
}

// HTTP fallback for listTeamMembers
async function listTeamMembersHTTP(
  teamId?: string,
  args: { pageSize?: number; cursor?: string; query?: string } = {},
): Promise<Paginated<TeamMember>> {
  const params: string[] = [];
  if (args.cursor) params.push(`cursor=${encodeURIComponent(args.cursor)}`);
  if (teamId) params.push(`team=${encodeURIComponent(teamId)}`);

  const queryString = params.length > 0 ? `?${params.join("&")}` : "";
  const resp = await authGet<unknown>(`/team_members${queryString}`);

  if (typeof resp !== "object" || resp === null) {
    return { items: [], nextCursor: undefined };
  }

  const r = resp as Record<string, unknown>;
  const itemsRaw = Array.isArray(r["items"]) ? (r["items"] as unknown[]) : [];
  const items = itemsRaw.map(mapTeamMemberFromHTTP).filter((tm): tm is TeamMember => Boolean(tm));
  const nextCursor = toStringOrUndefined(r["next_cursor"]) || undefined;

  return { items, nextCursor };
}

// Map raw HTTP response to TeamMember type
function mapTeamMemberFromHTTP(raw: unknown): TeamMember | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;

  const name = toStringOrUndefined(r["name"]);
  const email = toStringOrUndefined(r["email"]);

  if (!name || !email) return undefined;

  const emailDomain = email.includes("@") ? email.split("@")[1] : undefined;
  const createdAt = toStringOrUndefined(r["created_at"]);
  const team = toStringOrUndefined(r["team"]);

  return {
    id: email, // Use email as ID
    name,
    email,
    emailDomain,
    createdAt,
    teamId: undefined,
    team: team || undefined,
  };
}
