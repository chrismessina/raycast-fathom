import { List, Icon } from "@raycast/api";
import { useCachedPromise } from "@raycast/utils";
import type { Meeting } from "../types/Types";
import { formatDate, formatDuration } from "../utils/dates";
import { MeetingActions } from "../actions/MeetingActions";
import { getTeamColor } from "../utils/teamColors";

export function MeetingListItem({ meeting }: { meeting: Meeting }) {
  const createdDate = meeting.createdAt ? formatDate(meeting.createdAt) : "";
  const duration = meeting.durationSeconds ? formatDuration(meeting.durationSeconds) : "";

  // Fetch team color asynchronously
  const { data: teamColor } = useCachedPromise(
    async (teamName: string | null | undefined) => {
      if (!teamName) return undefined;
      return await getTeamColor(teamName);
    },
    [meeting.recordedByTeam],
    {
      initialData: undefined,
      keepPreviousData: true,
    },
  );

  return (
    <List.Item
      icon={Icon.Video}
      title={meeting.title}
      accessories={[
        // Show meeting date
        createdDate ? { text: createdDate, icon: Icon.Calendar } : undefined,
        // Show team if available with unique color
        meeting.recordedByTeam ? { tag: { value: meeting.recordedByTeam, color: teamColor || "#007AFF" } } : undefined,
        // Show action items count
        meeting.actionItemsCount !== undefined && meeting.actionItemsCount > 0
          ? { text: `${meeting.actionItemsCount}`, icon: Icon.CheckCircle }
          : undefined,
        // Show duration
        duration ? { text: duration, icon: Icon.Clock } : undefined,
      ].filter((x): x is NonNullable<typeof x> => x !== undefined)}
      actions={<MeetingActions meeting={meeting} />}
    />
  );
}
