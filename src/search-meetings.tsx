import { List, Icon, LaunchProps, Detail, Action, ActionPanel, showToast, Toast } from "@raycast/api";
import { useCachedPromise } from "@raycast/utils";
import { useState, useMemo, useEffect } from "react";
import { listMeetings, listTeams, listTeamMembers, getMeetingSummary, getMeetingTranscript } from "./fathom/api";
import type { Meeting, MeetingFilter } from "./types/Types";
import { MeetingActions, MeetingCopyActions, MeetingOpenActions, MeetingExportActions } from "./actions/MeetingActions";
import { getDateRanges, formatDate, formatDuration } from "./utils/dates";

interface LaunchContext {
  calendarInvitees?: string[];
  team?: string;
}

export default function SearchMeetings(props: LaunchProps<{ launchContext?: LaunchContext }>) {
  const launchContext = props.launchContext;
  const [filterType, setFilterType] = useState<string>("all");

  const ranges = getDateRanges();

  // Fetch teams and team members for dropdown with longer cache
  const { data: teamsData } = useCachedPromise(async () => listTeams({}), [], {
    keepPreviousData: true,
    initialData: { items: [], nextCursor: undefined },
  });
  const { data: membersData } = useCachedPromise(async () => listTeamMembers(undefined, {}), [], {
    keepPreviousData: true,
    initialData: { items: [], nextCursor: undefined },
  });

  const teams = teamsData?.items ?? [];
  const members = membersData?.items ?? [];

  // Initialize filter from launch context
  useEffect(() => {
    if (launchContext?.calendarInvitees && launchContext.calendarInvitees.length > 0) {
      setFilterType(`member:${launchContext.calendarInvitees[0]}`);
    } else if (launchContext?.team) {
      setFilterType(`team:${launchContext.team}`);
    }
  }, [launchContext]);

  // Build meeting filter based on dropdown selection
  const meetingFilter: MeetingFilter = useMemo(() => {
    const baseFilter: MeetingFilter = {};

    if (filterType.startsWith("member:")) {
      const email = filterType.replace("member:", "");
      baseFilter.calendarInvitees = [email];
    } else if (filterType.startsWith("team:")) {
      const teamName = filterType.replace("team:", "");
      baseFilter.teams = [teamName];
    }

    return baseFilter;
  }, [filterType]);

  // Fetch all meetings in a single call to reduce API requests
  const {
    data: allMeetingsData,
    isLoading,
    error,
  } = useCachedPromise(
    async (filter: MeetingFilter) =>
      listMeetings({
        ...filter,
        createdAfter: ranges.previousMonth.start.toISOString(),
        createdBefore: ranges.thisWeek.end.toISOString(),
      }),
    [meetingFilter],
    { keepPreviousData: true },
  );

  // Group meetings by date range
  const { thisWeekMeetings, lastWeekMeetings, previousMonthMeetings } = useMemo(() => {
    const allMeetings = allMeetingsData?.items ?? [];

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
    };
  }, [allMeetingsData, ranges]);

  const totalMeetings = thisWeekMeetings.length + lastWeekMeetings.length + previousMonthMeetings.length;

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Search meetings by title..."
      filtering={true}
      searchBarAccessory={
        <List.Dropdown tooltip="Filter by Team or Team Member" value={filterType} onChange={setFilterType}>
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

          {members.length > 0 && (
            <List.Dropdown.Section title="Team Members">
              {members.map((member) => (
                <List.Dropdown.Item
                  key={`member:${member.id}`}
                  title={`${member.name} (${member.email})`}
                  value={`member:${member.email}`}
                  icon={Icon.Person}
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
      ) : totalMeetings === 0 && !isLoading ? (
        <List.EmptyView
          icon={Icon.Calendar}
          title="No Meetings Found"
          description="Your recent meetings will appear here"
        />
      ) : (
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
      )}
    </List>
  );
}

function MeetingListItem({ meeting }: { meeting: Meeting }) {
  const createdDate = meeting.createdAt ? formatDate(meeting.createdAt) : "";
  const duration = meeting.durationSeconds ? formatDuration(meeting.durationSeconds) : "";

  return (
    <List.Item
      icon={Icon.Video}
      title={meeting.title}
      accessories={[
        // Show meeting date
        createdDate ? { text: createdDate, icon: Icon.Calendar } : undefined,
        // Show team if available
        meeting.recordedByTeam ? { tag: { value: meeting.recordedByTeam, color: "#007AFF" } } : undefined,
        // Show duration
        duration ? { text: duration, icon: Icon.Clock } : undefined,
      ].filter((x): x is NonNullable<typeof x> => x !== undefined)}
      actions={<MeetingActions meeting={meeting} />}
    />
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
