import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Incident } from '../../domain/incident';
import { listIncidents } from '../../composition/root';

type Props = {
  onSelectIncident: (id: string) => void;
};

export function IncidentListScreen({ onSelectIncident }: Props) {
  const [incidents, setIncidents] = useState<readonly Incident[]>([]);

  useEffect(() => {
    listIncidents().then(setIncidents);
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Incidencias</Text>
      <FlatList
        data={incidents}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Pressable
            testID={`incident-item-${item.id}`}
            onPress={() => onSelectIncident(item.id)}
            style={styles.item}
          >
            <Text style={styles.itemTitle}>{item.description}</Text>
            <Text>{item.status}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  title: { fontSize: 20, fontWeight: '700', marginBottom: 12 },
  item: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#ddd' },
  itemTitle: { fontSize: 16, fontWeight: '600' },
});