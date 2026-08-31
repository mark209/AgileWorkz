"use client";

import { useEffect, useState } from "react";
import { useAuth } from "./auth-context";
import { listInquirySources, listInquiryTypes, listTrades, type InquirySource, type InquiryType, type Trade } from "./api";

// Shared by every Phase 3 create/edit form that needs Trade / Inquiry
// Source / Inquiry Type dropdown options. These reference tables are
// read-only from Step 8 (D6) — no management UI, just consumption. Each
// call fetches independently (no cross-component cache) — acceptable for
// these small, rarely-changing lists rather than adding a shared context
// for it.
export function useReferenceData() {
  const { accessToken } = useAuth();
  const [trades, setTrades] = useState<Trade[]>([]);
  const [inquirySources, setInquirySources] = useState<InquirySource[]>([]);
  const [inquiryTypes, setInquiryTypes] = useState<InquiryType[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    Promise.all([listTrades(accessToken), listInquirySources(accessToken), listInquiryTypes(accessToken)])
      .then(([t, s, it]) => {
        if (cancelled) return;
        setTrades(t.filter((x) => x.status === "ACTIVE"));
        setInquirySources(s.filter((x) => x.status === "ACTIVE"));
        setInquiryTypes(it.filter((x) => x.status === "ACTIVE"));
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  return { trades, inquirySources, inquiryTypes, loaded };
}
