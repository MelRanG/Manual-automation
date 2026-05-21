export interface DemoWidgetProps {
  allowAllReasons: boolean
  onSaveBehavior: "none" | "weather-modal"
}

export function DemoWidget({ allowAllReasons, onSaveBehavior }: DemoWidgetProps) {
  return (
    <div className="min-h-screen bg-[#f7f9fb] flex flex-col items-center font-['Inter',sans-serif] text-[#191c1e]">
      <div className="w-full max-w-md flex flex-col">
        <div className="p-8 text-center text-sm text-[#444653]">
          DemoWidget shell ready · allowAllReasons={String(allowAllReasons)} · onSaveBehavior={onSaveBehavior}
        </div>
      </div>
    </div>
  )
}
