"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { Input } from "@/components/ui/input";

type SuggestionField = "leadTime" | "lineDescription" | "brand" | "model" | "unit" | "sectionName" | "checklistItem";
type SuggestionHistory = Partial<Record<SuggestionField, string[]>>;

const fields: SuggestionField[] = ["leadTime", "lineDescription", "brand", "model", "unit", "sectionName", "checklistItem"];
const storageKey = (userId: string) => `agileworks-quotation-suggestions:${userId}`;

function readHistory(userId: string): SuggestionHistory {
  try {
    const stored = JSON.parse(window.localStorage.getItem(storageKey(userId)) ?? "{}");
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
    return Object.fromEntries(fields.map((field) => [
      field,
      Array.isArray(stored[field])
        ? stored[field].filter((value: unknown) => typeof value === "string" && value.trim().length > 0).slice(0, 8)
        : [],
    ])) as SuggestionHistory;
  } catch {
    return {};
  }
}

export function useQuotationSuggestions() {
  const { user } = useAuth();
  const userId = user?.id;
  const [history, setHistory] = useState<SuggestionHistory>({});

  useEffect(() => {
    setHistory(userId ? readHistory(userId) : {});
  }, [userId]);

  const remember = useCallback((field: SuggestionField, value: string) => {
    if (!userId) return;
    const savedValue = value.trim();
    if (!savedValue || savedValue.length > 200) return;
    const current = readHistory(userId);
    const next = {
      ...current,
      [field]: [savedValue, ...(current[field] ?? []).filter((item) => item.toLocaleLowerCase() !== savedValue.toLocaleLowerCase())].slice(0, 8),
    };
    try {
      window.localStorage.setItem(storageKey(userId), JSON.stringify(next));
    } catch {
      // The quotation itself is already saved; unavailable browser storage must not block it.
    }
    setHistory(next);
  }, [userId]);

  return { history, remember };
}

export function SuggestedInput({ suggestions, ...props }: React.ComponentProps<typeof Input> & { suggestions: string[] }) {
  const listId = useId();
  return (
    <>
      <Input {...props} list={listId} />
      <datalist id={listId}>
        {suggestions.map((suggestion) => <option key={suggestion} value={suggestion} />)}
      </datalist>
    </>
  );
}
