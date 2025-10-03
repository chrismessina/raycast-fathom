import { List, Icon, Detail, ActionPanel, Action, showToast, Toast } from "@raycast/api";
import { useCachedPromise } from "@raycast/utils";
import { useMemo, useState } from "react";
import { listMeetings, listTeams, getMeetingSummary, getMeetingTranscript } from "./fathom/api";
import type { MeetingFilter, Meeting } from "./types/Types";
import { MeetingCopyActions, MeetingOpenActions, MeetingExportActions } from "./actions/MeetingActions";
import { MeetingActionItemsDetail } from "./view-action-items";
import { MeetingListItem } from "./components/MeetingListItem";
import { getDateRanges } from "./utils/dates";

export default function Command() {
  const [filterType, setFilterType] = useState<string>("all");

  const ranges = getDateRanges();

  // Fetch teams for dropdown
  const { data: teamsData } = useCachedPromise(async () => listTeams({}), [], {
    keepPreviousData: true,
    initialData: { items: [], nextCursor: undefined },
  });

  const teams = teamsData?.items ?? [];

  // Get display name for current filter
  const filterDisplayName = useMemo(() => {
    if (filterType === "all") return null;
    if (filterType.startsWith("team:")) {
      return filterType.replace("team:", "");
    }
    return null;
  }, [filterType]);

  // Fetch all meetings in a single call to reduce API requests
  const {
    data: allMeetingsData,
    isLoading,
    error,
  } = useCachedPromise(
    async (currentFilterType: string) => {
      // Build filter based on current selection
      const baseFilter: MeetingFilter = {};

      if (currentFilterType.startsWith("team:")) {
        const teamName = currentFilterType.replace("team:", "");
        baseFilter.teams = [teamName];
      }

      // When filtering by team, fetch ALL meetings (no date restriction)
      // When showing all meetings, restrict to recent date range
      const finalFilter: MeetingFilter = {
        ...baseFilter,
      };

      // Only apply date filters when NOT filtering by team
      if (currentFilterType === "all") {
        finalFilter.createdAfter = ranges.previousMonth.start.toISOString();
        finalFilter.createdBefore = ranges.thisWeek.end.toISOString();
      }

      return await listMeetings(finalFilter);
    },
    [filterType], // Use string directly for proper change detection
    { keepPreviousData: false }, // Don't keep previous data when filter changes
  );

  // Group meetings by date range (only when showing all meetings)
  // When filtered, show flat chronological list
  const { thisWeekMeetings, lastWeekMeetings, previousMonthMeetings, allFilteredMeetings } = useMemo(() => {
    const allMeetings = allMeetingsData?.items ?? [];

    // If filtering is active, return all meetings sorted by date (newest first)
    if (filterType !== "all") {
      const sorted = [...allMeetings].sort((a, b) => {
        const dateA = new Date(a.createdAt || a.startTimeISO).getTime();
        const dateB = new Date(b.createdAt || b.startTimeISO).getTime();
        return dateB - dateA; // Descending (newest first)
      });
      return {
        thisWeekMeetings: [],
        lastWeekMeetings: [],
        previousMonthMeetings: [],
        allFilteredMeetings: sorted,
      };
    }

    // No filter: group by date ranges
    const thisWeek: Meeting[] = [];
    const lastWeek: Meeting[] = [];
    const previousMonth: Meeting[] = [];

    allMeetings.forEach((meeting) => {
      const meetingDate = new Date(meeting.createdAt || meeting.startTimeISO);
      const meetingTime = meetingDate.getTime();

      if (meetingTime >= ranges.thisWeek.start.getTime() && meetingTime <= ranges.thisWeek.end.getTime()) {
        thisWeek.push(meeting);
      } else if (meetingTime >= ranges.lastWeek.start.getTime() && meetingTime <= ranges.lastWeek.end.getTime()) {
        lastWeek.push(meeting);
      } else if (
        meetingTime >= ranges.previousMonth.start.getTime() &&
        meetingTime <= ranges.previousMonth.end.getTime()
      ) {
        previousMonth.push(meeting);
      }
    });

    return {
      thisWeekMeetings: thisWeek,
      lastWeekMeetings: lastWeek,
      previousMonthMeetings: previousMonth,
      allFilteredMeetings: [],
    };
  }, [allMeetingsData, ranges, filterType]);

  const totalMeetings =
    filterType === "all"
      ? thisWeekMeetings.length + lastWeekMeetings.length + previousMonthMeetings.length
      : allFilteredMeetings.length;

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Search meetings by title..."
      filtering={true}
      navigationTitle={filterDisplayName ? `Meetings: ${filterDisplayName}` : "Search Meetings"}
      searchBarAccessory={
        <List.Dropdown tooltip="Filter by Team" value={filterType} onChange={setFilterType}>
          <List.Dropdown.Item title="All Meetings" value="all" />

          {teams.length > 0 && (
            <List.Dropdown.Section title="Teams">
              {teams.map((team) => (
                <List.Dropdown.Item
                  key={`team:${team.id}`}
                  title={team.name}
                  value={`team:${team.name}`}
                  icon={Icon.PersonLines}
                />
              ))}
            </List.Dropdown.Section>
          )}
        </List.Dropdown>
      }
    >
      {error ? (
        <List.EmptyView
          icon={Icon.ExclamationMark}
          title={
            error instanceof Error && error.message.includes("Rate limit")
              ? "Rate Limit Exceeded"
              : "Failed to Load Meetings"
          }
          description={
            error instanceof Error && error.message.includes("Rate limit")
              ? "You've made too many requests. Please wait a moment and try again."
              : error instanceof Error
                ? error.message
                : String(error)
          }
        />
      ) : totalMeetings === 0 ? (
        <List.EmptyView
          icon={Icon.Calendar}
          title="No Meetings Found"
          description={
            filterDisplayName ? `No meetings found for ${filterDisplayName}` : "Your recent meetings will appear here"
          }
        />
      ) : filterType === "all" ? (
        // Grouped view (no filter)
        <>
          {thisWeekMeetings.length > 0 && (
            <List.Section title="This Week" subtitle={`${thisWeekMeetings.length} meetings`}>
              {thisWeekMeetings.map((meeting) => (
                <MeetingListItem key={meeting.id} meeting={meeting} />
              ))}
            </List.Section>
          )}

          {lastWeekMeetings.length > 0 && (
            <List.Section title="Last Week" subtitle={`${lastWeekMeetings.length} meetings`}>
              {lastWeekMeetings.map((meeting) => (
                <MeetingListItem key={meeting.id} meeting={meeting} />
              ))}
            </List.Section>
          )}

          {previousMonthMeetings.length > 0 && (
            <List.Section title="Previous Month" subtitle={`${previousMonthMeetings.length} meetings`}>
              {previousMonthMeetings.map((meeting) => (
                <MeetingListItem key={meeting.id} meeting={meeting} />
              ))}
            </List.Section>
          )}
        </>
      ) : (
        // Flat chronological list (when filtered)
        <List.Section title={filterDisplayName || "Filtered Meetings"} subtitle={`${totalMeetings} meetings`}>
          {allFilteredMeetings.map((meeting) => (
            <MeetingListItem key={meeting.id} meeting={meeting} />
          ))}
        </List.Section>
      )}
    </List>
  );
}

// Summary Detail View
export function MeetingSummaryDetail({ meeting, recordingId }: { meeting: Meeting; recordingId: string }) {
  const {
    data: summary,
    isLoading,
    error,
  } = useCachedPromise(async (id: string) => getMeetingSummary(id), [recordingId], {
    onError: (err) => {
      showToast({
        style: Toast.Style.Failure,
        title: "Failed to load summary",
        message: err instanceof Error ? err.message : String(err),
      });
    },
  });

  // Build markdown without action items (they have their own dedicated view now)
  const markdown = error
    ? `# Error\n\n${error instanceof Error ? error.message : String(error)}`
    : isLoading
      ? "Loading summary..."
      : summary?.text || "No summary available";

  return (
    <Detail
      markdown={markdown}
      navigationTitle={meeting.title}
      isLoading={isLoading}
      actions={
        <ActionPanel>
          <Action.Push
            title="View Transcript"
            icon={Icon.Text}
            target={<MeetingTranscriptDetail meeting={meeting} recordingId={recordingId} />}
            shortcut={{ modifiers: ["cmd"], key: "t" }}
          />
          <Action.Push
            title="View Action Items"
            icon={Icon.CheckCircle}
            target={<MeetingActionItemsDetail meeting={meeting} />}
            shortcut={{ modifiers: ["cmd"], key: "i" }}
          />

          <MeetingCopyActions
            meeting={meeting}
            additionalContent={{
              title: "Copy Summary",
              content: summary?.text || "",
              shortcut: { modifiers: ["cmd"], key: "c" },
            }}
          />
          <MeetingOpenActions meeting={meeting} />
          <MeetingExportActions meeting={meeting} recordingId={recordingId} />
        </ActionPanel>
      }
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title="Meeting" text={meeting.title} />
          {meeting.meetingTitle && <Detail.Metadata.Label title="Calendar Title" text={meeting.meetingTitle} />}
          {meeting.createdAt && (
            <Detail.Metadata.Label
              title="Date"
              text={new Date(meeting.createdAt).toLocaleDateString("en-US", {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            />
          )}
          {meeting.durationSeconds && (
            <Detail.Metadata.Label title="Duration" text={`${Math.round(meeting.durationSeconds / 60)} minutes`} />
          )}
          {meeting.actionItemsCount !== undefined && meeting.actionItemsCount > 0 && (
            <Detail.Metadata.Label title="Action Items" text={String(meeting.actionItemsCount)} />
          )}
          {meeting.recordedByTeam && <Detail.Metadata.Label title="Team" text={meeting.recordedByTeam} />}
          {meeting.recordedByName && <Detail.Metadata.Label title="Recorded By" text={meeting.recordedByName} />}
        </Detail.Metadata>
      }
    />
  );
}

// Transcript Detail View
export function MeetingTranscriptDetail({ meeting, recordingId }: { meeting: Meeting; recordingId: string }) {
  const {
    data: transcript,
    isLoading,
    error,
  } = useCachedPromise(async (id: string) => getMeetingTranscript(id), [recordingId], {
    onError: (err) => {
      showToast({
        style: Toast.Style.Failure,
        title: "Failed to load transcript",
        message: err instanceof Error ? err.message : String(err),
      });
    },
  });

  const markdown = error
    ? `# Error\n\n${error instanceof Error ? error.message : String(error)}`
    : isLoading
      ? "Loading transcript..."
      : transcript?.text || "No transcript available";

  return (
    <Detail
      markdown={markdown}
      navigationTitle={`${meeting.title} - Transcript`}
      isLoading={isLoading}
      actions={
        <ActionPanel>
          <Action.Push
            title="View Summary"
            icon={Icon.Document}
            target={<MeetingSummaryDetail meeting={meeting} recordingId={recordingId} />}
            shortcut={{ modifiers: ["cmd"], key: "s" }}
          />

          <MeetingCopyActions
            meeting={meeting}
            additionalContent={{
              title: "Copy Transcript",
              content: transcript?.text || "",
              shortcut: { modifiers: ["cmd"], key: "c" },
            }}
          />
          <MeetingOpenActions meeting={meeting} />
          <MeetingExportActions meeting={meeting} recordingId={recordingId} />
        </ActionPanel>
      }
    />
  );
}
