interface WheelPanEvent {
  deltaX: number
  deltaY: number
  shiftKey: boolean
}

interface PointerPanEvent {
  button: number
}

interface PointerPanOptions {
  spaceHeld: boolean
}

export function panDeltaFromWheel(event: WheelPanEvent): { dx: number; dy: number } {
  const wheelX = event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX
  const wheelY = event.shiftKey ? 0 : event.deltaY
  return { dx: invertWheelDelta(wheelX), dy: invertWheelDelta(wheelY) }
}

export function shouldStartCanvasPointerPan(
  event: PointerPanEvent,
  { spaceHeld }: PointerPanOptions,
): boolean {
  return spaceHeld && event.button === 0
}

function invertWheelDelta(delta: number): number {
  return delta === 0 ? 0 : -delta
}
