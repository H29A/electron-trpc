import { ipcRenderer, contextBridge } from 'electron';
import { ELECTRON_TRPC_CHANNEL } from '../constants';
import type { RendererGlobalElectronTRPC } from '../types';

export const exposeElectronTRPC = (channel = ELECTRON_TRPC_CHANNEL) => {
  const electronTRPC: RendererGlobalElectronTRPC = {
    sendMessage: (operation) => ipcRenderer.send(channel, operation),
    onMessage: (callback) =>
      ipcRenderer.on(channel, (_event, args) => callback(args)),
  };

  if (channel === ELECTRON_TRPC_CHANNEL) {
    contextBridge.exposeInMainWorld('electronTRPC', electronTRPC);
  } else {
    contextBridge.exposeInMainWorld('electronTRPC_' + channel, electronTRPC);
  }
};
