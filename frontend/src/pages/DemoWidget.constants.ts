export const CUSTOMER = {
  address: "서울 강서구 마곡중앙로 143(마곡동), 르웨스트시티 타워 B동 10층",
  phone: "02-2127-8300",
  eta: "26.05.22, 10:30",
} as const

export const DEFAULT_MESSAGE = "고객님, 기다리시던 택배 배송드립니다."

export const TOAST = {
  title: "[물류통제실 알림]",
  body: "기상악화로 배송 지연 안내문 발송",
} as const

export const REASONS = [
  { key: "traffic", label: "교통사고", alwaysEnabled: true },
  { key: "address", label: "주소지/연락처 오류", alwaysEnabled: true },
  { key: "weather", label: "기상악화", alwaysEnabled: false },
  { key: "holiday", label: "명절", alwaysEnabled: false },
  { key: "damage", label: "포장 파손", alwaysEnabled: true },
  { key: "etc", label: "기타", alwaysEnabled: true },
] as const

export type ReasonKey = (typeof REASONS)[number]["key"]
