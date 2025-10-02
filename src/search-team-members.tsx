import { List, Icon } from "@raycast/api";
import { useCachedPromise } from "@raycast/utils";
import { useMemo, useState } from "react";
import { listTeamMembers } from "./fathom/api";
import type { Paginated, TeamMember } from "./types/Types";
import { TeamMemberActions } from "./actions/TeamMemberActions";
import { useDebouncedValue } from "./utils/debounce";

export default function Command() {
  const [query, setQuery] = useState<string>("");
  const debounced = useDebouncedValue(query, 300);

  const { data, isLoading, revalidate } = useCachedPromise(async () => listTeamMembers(undefined, {}), [], {
    keepPreviousData: true,
  });

  const page: Paginated<TeamMember> | undefined = data;
  const items = useMemo(() => {
    const raw = page?.items ?? [];
    const q = debounced.trim().toLowerCase();
    if (!q) return raw;
    return raw.filter((m) => m.name.toLowerCase().includes(q) || (m.email ? m.email.toLowerCase().includes(q) : false));
  }, [page?.items, debounced]);

  // Group members by team
  const groupedMembers = useMemo(() => {
    const groups = new Map<string, TeamMember[]>();
    items.forEach((member) => {
      const teamName = member.team || "No Team";
      if (!groups.has(teamName)) {
        groups.set(teamName, []);
      }
      groups.get(teamName)?.push(member);
    });
    return groups;
  }, [items]);

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Search team members by name or email…"
      onSearchTextChange={setQuery}
    >
      {items.length === 0 && !isLoading ? (
        <List.EmptyView
          icon={Icon.Person}
          title="No Team Members Found"
          description={query ? `No team members match "${query}"` : "Your team members will appear here"}
        />
      ) : (
        Array.from(groupedMembers.entries()).map(([teamName, members]) => (
          <List.Section
            key={teamName}
            title={teamName}
            subtitle={`${members.length} ${members.length === 1 ? "member" : "members"}`}
          >
            {members.map((tm) => (
              <List.Item
                key={tm.id}
                icon={Icon.Person}
                title={tm.name}
                subtitle={tm.email}
                accessories={[
                  tm.emailDomain ? { tag: { value: tm.emailDomain, color: "#8E8E93" } } : undefined,
                  tm.createdAt ? { text: new Date(tm.createdAt).toLocaleDateString(), icon: Icon.Calendar } : undefined,
                ].filter((x): x is NonNullable<typeof x> => x !== undefined)}
                actions={<TeamMemberActions member={tm} onRefresh={revalidate} />}
              />
            ))}
          </List.Section>
        ))
      )}
    </List>
  );
}
