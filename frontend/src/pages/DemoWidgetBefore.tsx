import { DemoWidget } from "./DemoWidget"

export function DemoWidgetBefore() {
  return (
    <DemoWidget
      allowAllReasons={false}
      onSaveBehavior="none"
      showEtcInput={false}
      loggedIn={true}
    />
  )
}
