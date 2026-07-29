/**
 * The `node-onvif` package (used instead of `onvif` for device/media/PTZ
 * calls - see /memories/repo notes for why) ships no type definitions.
 * Declared loosely here; call sites narrow what they need.
 */
declare module "node-onvif" {
  const nodeOnvif: any;
  export default nodeOnvif;
}

/**
 * node-onvif's PTZ service client, imported directly (bypassing the main
 * module) so onvif/ptz.ts can construct one pointed at a corrected XAddr -
 * see that file for why (some cheap OEM cameras report shifted/wrong
 * per-service XAddrs in GetCapabilities).
 */
declare module "node-onvif/lib/modules/service-ptz.js" {
  interface OnvifServicePtzParams {
    xaddr: string;
    user?: string;
    pass?: string;
  }
  class OnvifServicePtz {
    constructor(params: OnvifServicePtzParams);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    continuousMove(params: any): Promise<any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    stop(params: any): Promise<any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    gotoPreset(params: any): Promise<any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setPreset(params: any): Promise<any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getPresets(params: any): Promise<any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getNodes(): Promise<any>;
  }
  export default OnvifServicePtz;
}
