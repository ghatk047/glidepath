import { createContext, useContext, type ReactNode } from 'react';
import type { ApiClient } from '@glidepath/api-contract';
import type { ServerState } from './server-state';

interface Services {
  client: ApiClient;
  serverState: ServerState;
}

const DataContext = createContext<Services | null>(null);

export interface DataProviderProps extends Services {
  children: ReactNode;
}

/** Puts the typed client and the server-state cache under the app. */
export function DataProvider({ client, serverState, children }: DataProviderProps) {
  return <DataContext.Provider value={{ client, serverState }}>{children}</DataContext.Provider>;
}

function useServices(): Services {
  const services = useContext(DataContext);
  if (!services) throw new Error('data hooks need a <DataProvider> above them');
  return services;
}

export const useApiClient = (): ApiClient => useServices().client;
export const useServerState = (): ServerState => useServices().serverState;
