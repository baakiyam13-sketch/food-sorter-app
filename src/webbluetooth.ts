// The real Web Bluetooth link to the board. Works in Chrome on Android and
// desktop Chrome; not on iPhones. The page must be served over HTTPS (Netlify
// does that) or be on localhost, and the first connection must come from a tap.

import {
  BLE_COMMAND_UUID,
  BLE_DEVICE_NAME,
  BLE_REPLY_UUID,
  BLE_SERVICE_UUID,
  type BleLink,
} from './ble';

export function bluetoothSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.bluetooth;
}

export async function openWebBluetoothLink(): Promise<BleLink> {
  if (!navigator.bluetooth) {
    throw new Error('This browser cannot do Bluetooth. Use Chrome on an Android phone.');
  }
  // Show only boards that offer the food sorter service.
  const device = await navigator.bluetooth.requestDevice({
    filters: [{ services: [BLE_SERVICE_UUID] }],
  });
  const link = new WebBluetoothLink(device);
  await link.reconnect();
  return link;
}

class WebBluetoothLink implements BleLink {
  private command: BluetoothRemoteGATTCharacteristic | null = null;
  private onReply: (text: string) => void = () => {};
  private onDisconnect: () => void = () => {};
  private decoder = new TextDecoder();
  private encoder = new TextEncoder();

  constructor(private device: BluetoothDevice) {
    device.addEventListener('gattserverdisconnected', () => {
      this.command = null;
      this.onDisconnect();
    });
  }

  get connected(): boolean {
    return !!this.device.gatt?.connected && this.command !== null;
  }

  get name(): string {
    return this.device.name || BLE_DEVICE_NAME;
  }

  setReplyHandler(handler: (text: string) => void): void {
    this.onReply = handler;
  }

  setDisconnectHandler(handler: () => void): void {
    this.onDisconnect = handler;
  }

  async reconnect(): Promise<void> {
    const server = await this.device.gatt!.connect();
    const service = await server.getPrimaryService(BLE_SERVICE_UUID);
    const reply = await service.getCharacteristic(BLE_REPLY_UUID);
    reply.addEventListener('characteristicvaluechanged', () => {
      if (reply.value) this.onReply(this.decoder.decode(reply.value));
    });
    await reply.startNotifications();
    this.command = await service.getCharacteristic(BLE_COMMAND_UUID);
  }

  async write(text: string): Promise<void> {
    if (!this.command) throw new Error('The board is not connected.');
    await this.command.writeValue(this.encoder.encode(text));
  }

  disconnect(): void {
    if (this.device.gatt?.connected) this.device.gatt.disconnect();
    this.command = null;
  }
}
