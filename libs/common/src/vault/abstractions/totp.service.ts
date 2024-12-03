// @ts-strict-ignore
export abstract class TotpService {
  getCode: (key: string) => Promise<string>;
  getTimeInterval: (key: string) => number;
}
