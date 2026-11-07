export {};
declare global {
  var dshBindControlPill: ((element: HTMLElement | null) => void) | undefined;
  var dshStartAnnotation: (() => Promise<void>) | undefined;
  var dshCollapseControl: ((collapsed: boolean) => void) | undefined;
  var dshSetControlState: ((state: { active: boolean }) => void) | undefined;
  var dshIsControlEvent: ((event: Event) => boolean) | undefined;
  var dshIsAnnotationEvent: ((event: Event) => boolean) | undefined;
  var dshFocusControl: (() => boolean) | undefined;
  var dshFocusControlDock: (() => boolean) | undefined;
  var dshSetTakeoverState: ((value: { active: boolean; state?: import("@/cooperation/types").CooperationView }) => void) | undefined;
}
