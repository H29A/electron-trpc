import type { AnyRouter, inferRouterContext } from '@trpc/server';
import { ipcMain, BrowserWindow }from 'electron';
import type { IpcMainEvent, WebContents } from 'electron';
import { handleIPCMessage } from './handleIPCMessage';
import { CreateContextOptions } from './types';
import { ELECTRON_TRPC_CHANNEL } from '../constants';
import { ETRPCRequest } from '../types';
import { Unsubscribable } from '@trpc/server/observable';
import debugFactory from 'debug';

const debug = debugFactory('electron-trpc:main:IPCHandler');

type Awaitable<T> = T | Promise<T>;

const getInternalId = (event: IpcMainEvent, request: ETRPCRequest) => {
  const messageId = request.method === 'request' ? request.operation.id : request.id;
  return `${event.sender.id}-${event.senderFrame.routingId}:${messageId}`;
};

class IPCHandler<TRouter extends AnyRouter> {
  #webContents: WebContents[] = [];
  #subscriptions: Map<string, Unsubscribable> = new Map();
  #channel: string;

  constructor({
    createContext,
    router,
    windows = [],
    webContents = [],
    channel = ELECTRON_TRPC_CHANNEL,
  }: {
    createContext?: (opts: CreateContextOptions) => Awaitable<inferRouterContext<TRouter>>;
    router: TRouter;
    windows?: BrowserWindow[];
    webContents?: WebContents[];
    channel?: string;
  }) {
    this.#channel = channel;

    windows.forEach((win) => this.attachWebContents(win.webContents));
    webContents.forEach((wc) => this.attachWebContents(wc));

    ipcMain.on(this.#channel, (event: IpcMainEvent, request: ETRPCRequest) => {
      handleIPCMessage({
        router,
        createContext,
        internalId: getInternalId(event, request),
        event,
        message: request,
        subscriptions: this.#subscriptions,
        channel: this.#channel,
      });
    });
  }

  attachWebContents(wc: WebContents) {
    if (this.#webContents.includes(wc)) {
      return;
    }

    debug('Attaching webContents', wc.id);

    this.#webContents.push(wc);
    this.#attachSubscriptionCleanupHandlers(wc);
  }

  detachWebContents(wc: WebContents, webContentsId: number) {
    debug('Detaching webContents', wc.id);

    const win = BrowserWindow.fromWebContents(wc);

    if (win?.isDestroyed() && webContentsId === undefined) {
      throw new Error('webContentsId is required when calling detachWindow on a destroyed window');
    }

    this.#webContents = this.#webContents.filter((wc) => BrowserWindow.fromWebContents(wc) !== null && BrowserWindow.fromWebContents(wc) !== win);
    this.#cleanUpSubscriptions({ webContentsId: webContentsId });
  }

  #cleanUpSubscriptions({
    webContentsId,
    frameRoutingId,
  }: {
    webContentsId: number;
    frameRoutingId?: number;
  }) {
    for (const [key, sub] of this.#subscriptions.entries()) {
      if (key.startsWith(`${webContentsId}-${frameRoutingId ?? ''}`)) {
        debug('Closing subscription', key);
        sub.unsubscribe();
        this.#subscriptions.delete(key);
      }
    }
  }

  #attachSubscriptionCleanupHandlers(wc: Electron.WebContents) {
    const webContentsId = wc.id;

    wc.on(
      'did-start-navigation',
      (
        _event,
        _url,
        isInPlace: boolean,
        _isMainFrame,
        _frameProcessId,
        frameRoutingId
      ) => {
        // Check if it's a hard navigation
        if (!isInPlace) {
          debug(
            'Handling hard navigation event',
            `webContentsId: ${webContentsId}`,
            `frameRoutingId: ${frameRoutingId}`
          );
          this.#cleanUpSubscriptions({
            webContentsId,
            frameRoutingId,
          });
        }
      }
    );
  
    wc.on('destroyed', () => {
      debug('Handling webContents `destroyed` event');
      const win = BrowserWindow.fromWebContents(wc);
      if (win) {
        this.detachWebContents(wc, webContentsId);
      }
    });
  }
}

export const createIPCHandler = <TRouter extends AnyRouter>({
  createContext,
  router,
  windows = [],
  webContents = [],
  channel,
}: {
  createContext?: (opts: CreateContextOptions) => Promise<inferRouterContext<TRouter>>;
  router: TRouter;
  windows?: Electron.BrowserWindow[];
  webContents?: Electron.WebContents[];
  channel?: string;
}) => {
  return new IPCHandler({ createContext, router, windows, webContents, channel });
};
