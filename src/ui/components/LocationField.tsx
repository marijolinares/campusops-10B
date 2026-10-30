import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { IncidentLocation } from '../../campusops/contracts';

type Props = {
  /** Resuelve con el proveedor (vía adaptador) o cae a la etiqueta manual. */
  resolveLocation: (query: string, manualLabel: string) => Promise<IncidentLocation>;
  onLocation: (location: IncidentLocation) => void;
};

/**
 * Captura de ubicación con alternativa manual: la persona siempre puede escribir
 * edificio, zona o referencia. Si el proveedor falla, se conserva lo escrito y se
 * avisa; no se inventan coordenadas.
 */
export function LocationField({ resolveLocation, onLocation }: Props) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit() {
    const label = text.trim();
    if (label === '') {
      setMessage('Escribe el edificio, la zona o una referencia.');
      return;
    }
    setBusy(true);
    try {
      const location = await resolveLocation(label, label);
      onLocation(location);
      setMessage(
        location.source === 'provider'
          ? `Ubicación encontrada: ${location.label}`
          : 'No hay ubicación automática; se guardará la referencia escrita.',
      );
    } catch {
      onLocation({ source: 'manual', label });
      setMessage('No hay ubicación automática; se guardará la referencia escrita.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Ubicación (edificio, zona o referencia)</Text>
      <TextInput
        testID="location-input"
        style={styles.input}
        value={text}
        onChangeText={setText}
        placeholder="Ej. Edificio A, planta baja"
        accessibilityLabel="Ubicación de la incidencia"
      />
      <Pressable testID="location-submit" accessibilityRole="button" disabled={busy} onPress={submit} style={styles.button}>
        <Text style={styles.buttonText}>{busy ? 'Buscando…' : 'Usar ubicación'}</Text>
      </Pressable>
      {message ? <Text testID="location-message">{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 8, padding: 12 },
  label: { fontWeight: '600' },
  input: { borderWidth: 1, borderColor: '#999', borderRadius: 6, padding: 8 },
  button: { backgroundColor: '#1d4ed8', borderRadius: 6, padding: 10, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '600' },
});
