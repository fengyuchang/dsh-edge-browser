export {};
declare global {
  var dshBindControlPill: ((element: HTMLElement | null) => void) | undefined;
  var dshStartAnnotation: (() => Promise<void>) | undefined;
  var dshCollapseControl: ((collapsed: boolean) => void) | undefined;
  var dshSetControlState: ((state: { active: boolean }) => void) | undefined;
}
