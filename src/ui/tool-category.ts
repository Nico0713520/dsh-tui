export type ToolCategory = "read" | "search" | "edit" | "test" | "run" | "other"

export function toolCategory(name: string): ToolCategory {
  const value = name.toLowerCase()
  if (/test|vitest|pytest/.test(value)) return "test"
  if (/search|grep|glob|find/.test(value)) return "search"
  if (/write|edit|patch|move|rename|delete/.test(value)) return "edit"
  if (/read|list|stat|inspect/.test(value)) return "read"
  if (/bash|shell|command|exec|pwsh/.test(value)) return "run"
  return "other"
}

export function toolCategoryLabel(category: ToolCategory): string {
  const labels: Record<ToolCategory, string> = {
    read: "Read",
    search: "Search",
    edit: "Edit",
    test: "Test",
    run: "Run",
    other: "Tool",
  }
  return labels[category]
}
