const LANGUAGE_TO_LOCALE: Record<string, string> = {
  en: "en-US",
  ko: "ko-KR",
  ja: "ja-JP",
  zh: "zh-Hant-TW",
  th: "th-TH",
}

export function localeForLanguage(language: string | null | undefined): string {
  const normalized = (language ?? "en").trim().toLowerCase()
  const primary = normalized.split(/[-_]/)[0]
  return LANGUAGE_TO_LOCALE[primary] ?? "en-US"
}

export function formatDisplayDate(
  value: string,
  language =
    typeof process !== "undefined" ? process.env.LANGUAGE : undefined,
): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""

  return new Intl.DateTimeFormat(localeForLanguage(language), {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date)
}
