import { DemoWidget } from "./DemoWidget"

export function DemoWidgetAfter() {
  return <DemoWidget allowAllReasons={true} onSaveBehavior="weather-modal" showEtcInput={true} reserveSpaceForChat={true} />
}
