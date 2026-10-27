// Crew (Oct 27): your fishing groups get their own tab — live boats, "Come to me", shared spots / routes / catches,
// group feed, float plans with overdue alerts, and invites. (Was the "My crew" part of Community.)
import { View } from 'react-native';
import { GroupsView, type GroupNav } from '../community/GroupsView';
import { ScreenHeader } from '../components/ui';
import { makeStyles } from '../theme';

export function CrewScreen({ groupNav, openGroup }: { groupNav: GroupNav; openGroup?: { id: string | null; at: number } | null }) {
  const st = useSt();
  return (
    <View style={st.root}>
      <ScreenHeader title="Crew" subtitle="Your groups · live boats · float plans" />
      <View style={st.body}>
        <GroupsView nav={groupNav} openGroupId={openGroup?.id ?? null} />
      </View>
    </View>
  );
}

const useSt = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1, paddingHorizontal: 16, paddingTop: 12 },
}));
