import { IpcMainEvent } from 'electron';

export interface IpcRequest {
  responseChannel?: string;

  params?: string[];
}

export interface IpcChannel {
  getName(): string;

  handle(event: IpcMainEvent, request: IpcRequest): void;
}
