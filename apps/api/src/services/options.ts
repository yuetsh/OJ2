import { inArray } from "drizzle-orm"

import { db, schema } from "../db"

export const websiteOptionDefaults = {
  website_base_url: "http://127.0.0.1",
  website_name: "Online Judge",
  website_name_shortcut: "oj",
  website_footer: "Online Judge Footer",
  allow_register: true,
  submission_list_show_all: true,
  class_list: [] as string[],
  enable_maxkb: true,
}

export async function getOptions<const T extends readonly string[]>(keys: T) {
  const rows = await db
    .select({ key: schema.optionsSysoptions.key, value: schema.optionsSysoptions.value })
    .from(schema.optionsSysoptions)
    .where(inArray(schema.optionsSysoptions.key, [...keys]))
  return Object.fromEntries(rows.map((row) => [row.key, row.value])) as Record<T[number], unknown>
}

export async function getWebsiteOptions() {
  const keys = Object.keys(websiteOptionDefaults) as Array<keyof typeof websiteOptionDefaults>
  const values = await getOptions(keys)
  return Object.fromEntries(
    keys.map((key) => [key, values[key] ?? websiteOptionDefaults[key]]),
  ) as typeof websiteOptionDefaults
}

export async function getBooleanOption(
  key: keyof typeof websiteOptionDefaults,
  fallback: boolean,
) {
  const values = await getOptions([key])
  return typeof values[key] === "boolean" ? values[key] : fallback
}
