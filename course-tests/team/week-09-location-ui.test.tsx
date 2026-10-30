import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { LocationField } from '../../src/ui/components/LocationField';

test('captura manual: sin proveedor se conserva lo escrito y no hay coordenadas', async () => {
  const onLocation = jest.fn();
  const view = await render(
    <LocationField resolveLocation={async (_q, manual) => ({ source: 'manual', label: manual })} onLocation={onLocation} />,
  );
  await fireEvent.changeText(view.getByTestId('location-input'), 'Biblioteca, segundo piso');
  await fireEvent.press(view.getByTestId('location-submit'));
  await waitFor(() => expect(onLocation).toHaveBeenCalledWith({ source: 'manual', label: 'Biblioteca, segundo piso' }));
  expect(view.getByTestId('location-message').props.children).toContain('referencia escrita');
});

test('si el adaptador lanza una excepción igual se conserva la referencia manual', async () => {
  const onLocation = jest.fn();
  const view = await render(
    <LocationField resolveLocation={async () => { throw new Error('boom'); }} onLocation={onLocation} />,
  );
  await fireEvent.changeText(view.getByTestId('location-input'), 'Laboratorio 3');
  await fireEvent.press(view.getByTestId('location-submit'));
  await waitFor(() => expect(onLocation).toHaveBeenCalledWith({ source: 'manual', label: 'Laboratorio 3' }));
});

test('proveedor válido se informa como encontrada', async () => {
  const onLocation = jest.fn();
  const view = await render(
    <LocationField
      resolveLocation={async () => ({ source: 'provider', label: 'Edificio A', latitude: 1, longitude: 2 })}
      onLocation={onLocation}
    />,
  );
  await fireEvent.changeText(view.getByTestId('location-input'), 'edificio a');
  await fireEvent.press(view.getByTestId('location-submit'));
  await waitFor(() => expect(view.getByTestId('location-message').props.children).toContain('Edificio A'));
});

test('texto vacío pide escribir una referencia y no llama al adaptador', async () => {
  const resolve = jest.fn();
  const view = await render(<LocationField resolveLocation={resolve} onLocation={jest.fn()} />);
  await fireEvent.press(view.getByTestId('location-submit'));
  await waitFor(() => expect(view.getByTestId('location-message').props.children).toContain('Escribe'));
  expect(resolve).not.toHaveBeenCalled();
});
