import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Incident } from '../../domain/incident';
import { getIncidentDetail } from '../../composition/root';

type Props = {
  incidentId: string;
};

export function IncidentDetailScreen({ incidentId }: Props) {
  const [incident, setIncident] = useState<Incident | null>(null);

  useEffect(() => {
    getIncidentDetail(incidentId).then(setIncident);
  }, [incidentId]);

  if (!incident) {
    return (
      <View style={styles.container}>
        <Text>Cargando...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="incident-detail">
      <Text style={styles.title}>{incident.description}</Text>
      <Text>Categoría: {incident.category}</Text>
      <Text>Estado: {incident.status}</Text>
      <Text>Ubicación: {incident.location}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  title: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
});