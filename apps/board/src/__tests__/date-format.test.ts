import { describe, expect, it } from "vitest"
import { formatDisplayDate, localeForLanguage } from "../lib/date-format.js"

describe("date formatting", () => {
  it("maps the English language setting to an English locale", () => {
    expect(localeForLanguage("en")).toBe("en-US")
    expect(formatDisplayDate("2026-05-27T09:30:00.000Z", "en")).toBe(
      "May 27, 2026",
    )
  })

  it("does not fall back to Korean when the language setting is English", () => {
    expect(formatDisplayDate("2026-05-27T09:30:00.000Z", "en")).not.toContain(
      "년",
    )
  })

  it("keeps supported non-English language settings explicit", () => {
    expect(localeForLanguage("ko")).toBe("ko-KR")
    expect(localeForLanguage("ja")).toBe("ja-JP")
  })
})
