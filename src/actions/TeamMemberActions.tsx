import { Action, ActionPanel, Icon, LaunchType, launchCommand, showToast, Toast, environment } from "@raycast/api";
import type { TeamMember } from "../types/Types";
import { exportAsVCard } from "../utils/export";
import path from "path";
import fs from "fs";

export function TeamMemberActions(props: { member: TeamMember; onRefresh?: () => void }) {
  const { member, onRefresh } = props;
  const email = member.email;

  const exportMemberDetails = async () => {
    try {
      const jsonContent = JSON.stringify(member, null, 2);

      const downloadsPath = path.join(environment.supportPath, "downloads");
      const filename = `${member.name.replace(/[^\w-]+/g, "_")}_details_${new Date().toISOString().slice(0, 10)}.json`;
      const filePath = path.join(downloadsPath, filename);

      // Write JSON file directly
      fs.mkdirSync(downloadsPath, { recursive: true });
      fs.writeFileSync(filePath, jsonContent, "utf8");

      await showToast({
        style: Toast.Style.Success,
        title: "Exported Member Details",
        message: `Saved ${filename}`,
      });
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Export Failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const exportMemberAsVCard = async () => {
    try {
      const note = member.createdAt
        ? `Fathom member since ${new Date(member.createdAt).toLocaleDateString()}`
        : undefined;

      const filePath = await exportAsVCard({
        name: member.name,
        email: member.email,
        organization: member.team || undefined,
        note,
      });

      const filename = path.basename(filePath);
      await showToast({
        style: Toast.Style.Success,
        title: "Exported to Contacts",
        message: `Saved ${filename}`,
      });
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Export Failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const viewMemberMeetings = async () => {
    if (!email) {
      await showToast({ style: Toast.Style.Failure, title: "No email address available" });
      return;
    }

    try {
      await launchCommand(
        { name: "search-meetings", type: LaunchType.UserInitiated },
        // @ts-expect-error launchContext is not defined in LaunchType.UserInitiated
        {
          launchContext: {
            calendarInvitees: [email],
          },
        },
      );
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to open meetings",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <ActionPanel>
      {/* Default Action */}
      {email && <Action.OpenInBrowser url={`mailto:${email}`} title="Send Email" icon={Icon.Envelope} />}

      {/* Copy Section */}
      <ActionPanel.Section title="Copy">
        <Action.CopyToClipboard
          title="Copy Name"
          content={member.name}
          icon={Icon.Person}
          shortcut={{ modifiers: ["cmd"], key: "c" }}
        />
        {email && (
          <Action.CopyToClipboard
            title="Copy Email Address"
            content={email}
            icon={Icon.Clipboard}
            shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
          />
        )}
        <Action.CopyToClipboard
          title="Copy All Details"
          content={JSON.stringify(member, null, 2)}
          icon={Icon.Document}
          shortcut={{ modifiers: ["cmd"], key: "." }}
        />
      </ActionPanel.Section>

      {/* Export Section */}
      <ActionPanel.Section title="Export">
        <Action
          title="Export Member as Vcard"
          onAction={exportMemberAsVCard}
          icon={Icon.AddPerson}
          shortcut={{ modifiers: ["cmd", "shift"], key: "e" }}
        />
        <Action title="Export Member as JSON" onAction={exportMemberDetails} icon={Icon.Download} />
      </ActionPanel.Section>

      {/* Other Actions */}
      {email && (
        <Action
          title="View Member's Meetings"
          icon={Icon.MagnifyingGlass}
          onAction={viewMemberMeetings}
          shortcut={{ modifiers: ["cmd"], key: "f" }}
        />
      )}
      {onRefresh && (
        <Action
          title="Refresh"
          onAction={onRefresh}
          icon={Icon.ArrowClockwise}
          shortcut={{ modifiers: ["cmd"], key: "r" }}
        />
      )}
    </ActionPanel>
  );
}
