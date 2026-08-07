export function parseProblemTemplate(template: string) {
  const section = (name: string) =>
    template.match(
      new RegExp(`//${name} BEGIN\\n([\\s\\S]+?)//${name} END`),
    )?.[1] ?? ""

  return {
    prepend: section("PREPEND"),
    template: section("TEMPLATE"),
    append: section("APPEND"),
  }
}
