declare module "react-native-zeroconf" {
  interface Service {
    name: string;
    host: string;
    port: number;
    addresses: string[];
    txt: Record<string, string>;
  }

  interface ZeroconfEvents {
    found: (service: Service) => void;
    lost: (service: Service) => void;
    resolved: (service: Service) => void;
    remove: (service: Service) => void;
    error: (error: string) => void;
    start: () => void;
    stop: () => void;
    update: (service: Service) => void;
  }

  class Zeroconf {
    scan(type?: string, protocol?: string, domain?: string): void;
    stop(): void;
    removeService(name: string): void;
    getServices(): Record<string, Service>;
    publishService(type: string, protocol: string, name: string, port: number, txt?: Record<string, string>): void;
    unpublishService(name: string): void;
    unpublishAll(): void;
    on<K extends keyof ZeroconfEvents>(event: K, listener: ZeroconfEvents[K]): this;
    once<K extends keyof ZeroconfEvents>(event: K, listener: ZeroconfEvents[K]): this;
    removeListener<K extends keyof ZeroconfEvents>(event: K, listener: ZeroconfEvents[K]): this;
    removeAllListeners(event?: keyof ZeroconfEvents): this;
    emit<K extends keyof ZeroconfEvents>(event: K, ...args: Parameters<ZeroconfEvents[K]>): boolean;
  }

  export default Zeroconf;
}
