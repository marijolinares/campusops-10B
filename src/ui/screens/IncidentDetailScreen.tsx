import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Incident } from '../../domain/incident';
import { getIncidentDetail } from '../../composition/root';
import { IncidentClientError } from '../../api/clientErrors';

type Props = {
  incidentId: string;
};

type State =
  | { status: 'loading' }
  | { status: 'ready'; incident: Incident }
  | { status: 'empty' }
  | { status: 'error'; message: string };

export function IncidentDetailScreen({ incidentId }: Props) {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    getIncidentDetail(incidentId)
      .then((incident) => {
        if (active) setState(incident ? { status: 'ready', incident } : { status: 'empty' });
      })
      .catch((error: unknown) => {
        const message =
          error instanceof IncidentClientError ? error.message : 'No se pudo cargar la incidencia.';
        if (active) setState({ status: 'error', message });
      });
    return () => {
      active = false;
    };
  }, [incidentId]);

  if (state.status === 'loading') {
    return (
      <View style={styles.container}>
        <Text>Cargando...</Text>
      </View>
    );
  }

  if (state.status === 'error') {
    return (
      <View style={styles.container} testID="incident-error">
        <Text>{state.message}</Text>
      </View>
    );
  }

  if (state.status === 'empty') {
    return (
      <View style={styles.container} testID="incident-empty">
        <Text>La incidencia no tiene datos disponibles.</Text>
      </View>
    );
  }

  const { incident } = state;
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